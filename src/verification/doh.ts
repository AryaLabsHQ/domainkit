import * as DnsPacket from "@leichtgewicht/dns-packet";
import { Effect, Layer } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";
import * as DnsData from "./dns-data.ts";
import * as DnsResolver from "./resolver.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface Options {
  readonly endpoint: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

export function make(options: Options): DnsResolver.Interface {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return {
    resolve: Effect.fn("DnsOverHttps.resolve")((query) =>
      Effect.tryPromise({
        try: (effectSignal) =>
          request({ effectSignal, fetch, query, timeoutMs, endpoint: options.endpoint }),
        catch: (cause) =>
          cause instanceof DnsResolver.Error
            ? cause
            : new DnsResolver.Error({
                cause,
                message: cause instanceof Error ? cause.message : "DNS resolution failed",
                reason: "transport",
              }),
      }).pipe(Effect.flatMap((message) => decodeResolution(query, message))),
    ),
  };
}

export const layer = (options: Options): Layer.Layer<DnsResolver.Service> =>
  Layer.succeed(DnsResolver.Service, make(options));

export const toAsync = (options: Options): DnsResolver.AsyncInterface =>
  DnsResolver.toAsync(make(options));

function decodeResolution(
  query: DnsResolver.Query,
  message: Uint8Array,
): Effect.Effect<DnsResolver.Resolution, DnsResolver.Error> {
  return Effect.try({
    try: () => DnsPacket.decode(message),
    catch: (cause) =>
      new DnsResolver.Error({
        cause,
        message: "DoH returned an invalid DNS message",
        reason: "response",
      }),
  }).pipe(
    Effect.flatMap((packet) => validatePacket(query, packet)),
    Effect.flatMap(decodePacket),
  );
}

function decodePacket(
  packet: DnsPacket.Packet,
): Effect.Effect<DnsResolver.Resolution, DnsResolver.Error> {
  if (packet.rcode === "NXDOMAIN") {
    return Effect.succeed({ _tag: "nodata" });
  }
  if (packet.rcode !== "NOERROR") {
    return Effect.fail(
      new DnsResolver.Error({
        message: `DNS resolver returned ${packet.rcode ?? "an unknown response code"}`,
        reason: "response",
      }),
    );
  }
  if (packet.answers === undefined || packet.answers.length === 0) {
    return Effect.succeed({ _tag: "nodata" });
  }
  return Effect.forEach(packet.answers, decodeAnswer, { concurrency: "unbounded" }).pipe(
    Effect.map((answers): DnsResolver.Resolution => {
      const supportedAnswers = answers.filter((answer) => answer !== null);
      return supportedAnswers.length === 0
        ? { _tag: "nodata" }
        : { _tag: "answer", answers: supportedAnswers };
    }),
  );
}

function validatePacket(
  query: DnsResolver.Query,
  packet: DnsPacket.Packet,
): Effect.Effect<DnsPacket.Packet, DnsResolver.Error> {
  return Effect.try({
    try: () => {
      if (packet.type !== "response") throw new Error("DoH returned a DNS query");
      if (packet.id !== 0) throw new Error("DoH response used an unexpected message ID");
      if (packet.flag_tc) throw new Error("DoH returned a truncated DNS response");
      const questions = packet.questions ?? [];
      if (questions.length !== 1) throw new Error("DoH returned an unexpected question count");
      const question = questions[0];
      if (question === undefined) throw new Error("DoH response omitted the DNS question");
      if (
        question.class !== "IN" ||
        question.type !== query.type ||
        DomainName.parse(question.name) !== query.name
      ) {
        throw new Error("DoH response did not match the DNS question");
      }
      return packet;
    },
    catch: (cause) =>
      new DnsResolver.Error({
        cause,
        message: cause instanceof Error ? cause.message : "DoH returned an invalid DNS response",
        reason: "response",
      }),
  });
}

function decodeAnswer(
  answer: DnsPacket.Answer,
): Effect.Effect<DnsResolver.Answer | null, DnsResolver.Error> {
  return Effect.gen(function* () {
    if (answer.class !== "IN") return null;
    const decoded = yield* Effect.try({
      try: () => answerData(answer),
      catch: (cause) =>
        new DnsResolver.Error({
          cause,
          message: "DoH returned invalid DNS record data",
          reason: "response",
        }),
    });
    if (decoded === undefined) return null;
    const name = yield* DomainName.decode(answer.name);
    const data = yield* Effect.try({
      try: () => DnsData.parse(decoded.type, decoded.data),
      catch: (cause) =>
        new DnsResolver.Error({
          cause,
          message: "DoH returned invalid DNS record data",
          reason: "response",
        }),
    });
    if (answer.ttl === undefined) {
      return yield* new DnsResolver.Error({
        message: "DoH response omitted the DNS record TTL",
        reason: "response",
      });
    }
    return { data, name, ttl: answer.ttl, type: decoded.type };
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DnsResolver.Error
        ? cause
        : new DnsResolver.Error({ cause, message: cause.message, reason: "response" }),
    ),
  );
}

function answerData(
  answer: DnsPacket.Answer,
): { readonly data: string; readonly type: DnsRecord.Type } | undefined {
  switch (answer.type) {
    case "A":
    case "AAAA":
    case "CNAME":
    case "NS":
      return { data: answer.data, type: answer.type };
    case "CAA":
      return {
        data: `${answer.data.flags ?? 0} ${answer.data.tag} ${answer.data.value}`,
        type: answer.type,
      };
    case "MX":
      return {
        data: `${requiredNumber(answer.data.preference, "MX preference")} ${answer.data.exchange}`,
        type: answer.type,
      };
    case "SRV":
      return {
        data: [
          requiredNumber(answer.data.priority, "SRV priority"),
          requiredNumber(answer.data.weight, "SRV weight"),
          requiredNumber(answer.data.port, "SRV port"),
          answer.data.target,
        ].join(" "),
        type: answer.type,
      };
    case "TXT":
      return { data: decodeTxt(answer.data), type: answer.type };
    default:
      return undefined;
  }
}

function decodeTxt(data: DnsPacket.TxtData): string {
  const chunks = Array.isArray(data) ? data : [data];
  const encoded = chunks.map((chunk) =>
    typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
  );
  const length = encoded.reduce((total, chunk) => total + chunk.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of encoded) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

function requiredNumber(value: number | undefined, field: string): number {
  if (value === undefined) throw new Error(`DoH response omitted ${field}`);
  return value;
}

async function request(input: {
  readonly effectSignal: AbortSignal;
  readonly endpoint: string;
  readonly fetch: Fetch;
  readonly query: DnsResolver.Query;
  readonly timeoutMs: number;
}): Promise<Uint8Array> {
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
    const query = Uint8Array.from(
      DnsPacket.encode({
        flags: DnsPacket.RECURSION_DESIRED,
        id: 0,
        questions: [{ name: input.query.name, type: input.query.type }],
        type: "query",
      }),
    );
    const response = await input.fetch(new URL(input.endpoint), {
      body: query,
      headers: {
        accept: "application/dns-message",
        "content-type": "application/dns-message",
      },
      method: "POST",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DnsResolver.Error({
        message: `DoH returned HTTP ${response.status}`,
        reason: "transport",
      });
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/dns-message") {
      throw new DnsResolver.Error({
        message: `DoH returned unsupported content type ${contentType ?? "<missing>"}`,
        reason: "response",
      });
    }
    return new Uint8Array(await response.arrayBuffer());
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
