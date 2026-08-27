import { Effect, Layer, Schema } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";
import * as DnsData from "./dns-data.ts";
import * as DnsResolver from "./resolver.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const typeCodes: Readonly<Record<DnsRecord.Type, number>> = {
  A: 1,
  AAAA: 28,
  CAA: 257,
  CNAME: 5,
  MX: 15,
  NS: 2,
  SRV: 33,
  TXT: 16,
};

const DoHResponse = Schema.Struct({
  Answer: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        data: Schema.String,
        name: Schema.String,
        TTL: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        type: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      }),
    ),
  ),
  Status: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export interface Options {
  readonly endpoint?: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

export function make(options: Options = {}): DnsResolver.Interface {
  const endpoint = options.endpoint ?? "https://cloudflare-dns.com/dns-query";
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return {
    resolve: Effect.fn("CloudflareDnsOverHttps.resolve")((query) =>
      Effect.tryPromise({
        try: (effectSignal) => request({ effectSignal, endpoint, fetch, query, timeoutMs }),
        catch: (cause) =>
          cause instanceof DnsResolver.Error
            ? cause
            : new DnsResolver.Error({
                cause,
                message: cause instanceof Error ? cause.message : "DNS resolution failed",
                reason: "transport",
              }),
      }).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(DoHResponse)(body).pipe(
            Effect.mapError(
              (cause) =>
                new DnsResolver.Error({
                  cause,
                  message: "DoH returned an invalid JSON response",
                  reason: "transport",
                }),
            ),
          ),
        ),
        Effect.flatMap(decodeResolution),
      ),
    ),
  };
}

export const layer = (options: Options = {}): Layer.Layer<DnsResolver.Service> =>
  Layer.succeed(DnsResolver.Service, make(options));

export const toAsync = (options: Options = {}): DnsResolver.AsyncInterface =>
  DnsResolver.toAsync(make(options));

function decodeResolution(
  body: typeof DoHResponse.Type,
): Effect.Effect<DnsResolver.Resolution, DnsResolver.Error> {
  if (body.Status !== 0 || body.Answer === undefined || body.Answer.length === 0) {
    return Effect.succeed({ _tag: "nodata" });
  }
  return Effect.forEach(
    body.Answer,
    (answer) =>
      Effect.gen(function* () {
        const type = typeFromCode(answer.type);
        if (type === undefined) return null;
        const name = yield* DomainName.decode(answer.name);
        const data = yield* Effect.try({
          try: () => DnsData.parse(type, answer.data),
          catch: (cause) =>
            new DnsResolver.Error({
              cause,
              message: "DoH returned invalid DNS record data",
              reason: "transport",
            }),
        });
        return { data, name, ttl: answer.TTL, type };
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof DnsResolver.Error
            ? cause
            : new DnsResolver.Error({
                cause,
                message: cause.message,
                reason: "transport",
              }),
        ),
      ),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((answers) => answers.filter((answer) => answer !== null)),
    Effect.map((answers) =>
      answers.length === 0 ? { _tag: "nodata" as const } : { _tag: "answer" as const, answers },
    ),
  );
}

function typeFromCode(code: number): DnsRecord.Type | undefined {
  for (const [type, value] of Object.entries(typeCodes)) {
    if (value === code && Schema.is(DnsRecord.Type)(type)) return type;
  }
  return undefined;
}

async function request(input: {
  readonly effectSignal: AbortSignal;
  readonly endpoint: string;
  readonly fetch: Fetch;
  readonly query: DnsResolver.Query;
  readonly timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromEffect = () => controller.abort(input.effectSignal.reason);
  const abortFromHost = () => controller.abort(input.query.signal?.reason);
  input.effectSignal.addEventListener("abort", abortFromEffect, { once: true });
  input.query.signal?.addEventListener("abort", abortFromHost, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("DNS resolution timed out"));
  }, input.timeoutMs);
  try {
    const url = new URL(input.endpoint);
    url.searchParams.set("name", input.query.name);
    url.searchParams.set("type", input.query.type);
    const response = await input.fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DnsResolver.Error({
        message: `DoH returned HTTP ${response.status}`,
        reason: "transport",
      });
    }
    return await response.json();
  } catch (cause) {
    if (timedOut) {
      throw new DnsResolver.Error({ message: "DNS query timed out", reason: "timeout" });
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    input.effectSignal.removeEventListener("abort", abortFromEffect);
    input.query.signal?.removeEventListener("abort", abortFromHost);
  }
}
