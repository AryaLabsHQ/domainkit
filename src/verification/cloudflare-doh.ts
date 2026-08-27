import { Effect, Layer } from "effect";

import type { Fetch } from "../auth/oauth.ts";
import { parseDomainName } from "../domain/domain-name.ts";
import type { DnsRecordType } from "../domain/dns-record.ts";
import { ResolverError } from "../errors.ts";
import {
  type DnsAnswer,
  type DnsQuery,
  type DnsResolution,
  DnsResolver,
  type DnsResolverService,
  type PromiseDnsResolver,
  toPromiseDnsResolver,
} from "./resolver.ts";

const typeCodes: Readonly<Record<DnsRecordType, number>> = {
  A: 1,
  AAAA: 28,
  CAA: 257,
  CNAME: 5,
  MX: 15,
  NS: 2,
  SRV: 33,
  TXT: 16,
};
const recordTypes = new Map(
  Object.entries(typeCodes).map(([type, code]) => [code, type as DnsRecordType]),
);

export interface CloudflareDnsResolverOptions {
  readonly endpoint?: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

export class CloudflareDnsResolver implements DnsResolverService {
  readonly #endpoint: string;
  readonly #fetch: Fetch;
  readonly #timeoutMs: number;

  constructor(options: CloudflareDnsResolverOptions = {}) {
    this.#endpoint = options.endpoint ?? "https://cloudflare-dns.com/dns-query";
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
  }

  resolve(query: DnsQuery): Effect.Effect<DnsResolution, ResolverError> {
    return Effect.tryPromise({
      try: (effectSignal) => this.#resolve(query, effectSignal),
      catch: (cause) =>
        cause instanceof ResolverError
          ? cause
          : new ResolverError({
              message: cause instanceof Error ? cause.name : "DNS resolution failed",
              reason: "transport",
            }),
    });
  }

  get layer(): Layer.Layer<DnsResolverService> {
    return Layer.succeed(DnsResolver)(this);
  }

  get promise(): PromiseDnsResolver {
    return toPromiseDnsResolver(this);
  }

  async #resolve(query: DnsQuery, effectSignal: AbortSignal): Promise<DnsResolution> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = (signal: AbortSignal) => controller.abort(signal.reason);
    const abortFromEffect = () => abort(effectSignal);
    const abortFromHost = () => query.signal !== undefined && abort(query.signal);
    effectSignal.addEventListener("abort", abortFromEffect, { once: true });
    query.signal?.addEventListener("abort", abortFromHost, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("DNS resolution timed out"));
    }, this.#timeoutMs);
    try {
      const url = new URL(this.#endpoint);
      url.searchParams.set("name", query.name);
      url.searchParams.set("type", query.type);
      const response = await this.#fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ResolverError({
          message: `DoH returned HTTP ${response.status}`,
          reason: "transport",
        });
      }
      const body = (await response.json()) as {
        readonly Answer?: ReadonlyArray<{
          readonly data: string;
          readonly name: string;
          readonly TTL: number;
          readonly type: number;
        }>;
        readonly Status?: number;
      };
      if (body.Status !== 0 || body.Answer === undefined || body.Answer.length === 0) {
        return { _tag: "nodata" };
      }
      const answers: Array<DnsAnswer> = [];
      for (const answer of body.Answer) {
        const type = recordTypes.get(answer.type);
        if (type === undefined) continue;
        answers.push({
          data: normalizeDnsData(type, answer.data),
          name: parseDomainName(answer.name),
          ttl: answer.TTL,
          type,
        });
      }
      return answers.length === 0 ? { _tag: "nodata" } : { _tag: "answer", answers };
    } catch (cause) {
      if (timedOut) {
        throw new ResolverError({ message: "DNS query timed out", reason: "timeout" });
      }
      throw cause;
    } finally {
      clearTimeout(timer);
      effectSignal.removeEventListener("abort", abortFromEffect);
      query.signal?.removeEventListener("abort", abortFromHost);
    }
  }
}

/** Creates the Cloudflare DoH resolver shape consumed by the Promise facade. */
export function makeCloudflareDnsResolver(
  options: CloudflareDnsResolverOptions = {},
): PromiseDnsResolver {
  return new CloudflareDnsResolver(options).promise;
}

export function normalizeDnsData(type: DnsRecordType, data: string): string {
  const trimmed = data.trim();
  switch (type) {
    case "CNAME":
    case "NS":
      return trimmed.toLowerCase().replace(/\.+$/, "");
    case "MX":
      return trimmed.replace(/\.+$/, "").toLowerCase();
    case "SRV": {
      const parts = trimmed.split(/\s+/);
      if (parts.length === 4) parts[3] = parts[3]!.toLowerCase().replace(/\.+$/, "");
      return parts.join(" ");
    }
    case "TXT": {
      const chunks = [...trimmed.matchAll(/"((?:\\.|[^"])*)"/g)];
      return chunks.length === 0
        ? trimmed
        : chunks.map((match) => match[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\")).join("");
    }
    case "CAA":
      return trimmed.replace(/\s+"([\s\S]*)"$/, " $1");
    case "A":
    case "AAAA":
      return trimmed.toLowerCase();
  }
}
