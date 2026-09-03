/**
 * Public DNS observation. The default layer fans out to Cloudflare and Google DNS-over-HTTPS and
 * keeps every answer, so verification can show "found at Cloudflare, missing at Google".
 */
import { Context, Effect, Layer } from "effect";

import type * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as DomainName from "./DomainName.ts";
import * as Doh from "./internal/doh.ts";
import type { Fetch } from "./internal/http.ts";

export interface Answer {
  readonly resolver: string;
  readonly records: ReadonlyArray<DnsRecord.Observed>;
  readonly negative: boolean;
  readonly ttl: number | null;
}

export type Outcome =
  | { readonly _tag: "Answered"; readonly answer: Answer }
  | { readonly _tag: "Failed"; readonly resolver: string; readonly message: string }
  | { readonly _tag: "TimedOut"; readonly resolver: string };

export interface Service {
  /** Never fails: each resolver's outcome is preserved. */
  readonly resolve: (name: string, type: DnsRecord.Type) => Effect.Effect<ReadonlyArray<Outcome>>;
}

export class Resolver extends Context.Service<Resolver, Service>()("@domainkit/Resolver") {}

export interface Endpoint {
  readonly name: string;
  readonly url: string;
}

export interface Options {
  readonly endpoints?: ReadonlyArray<Endpoint>;
  readonly timeoutMs?: number;
  readonly fetch?: Fetch;
}

export const cloudflare: Endpoint = {
  name: "cloudflare",
  url: "https://cloudflare-dns.com/dns-query",
};
export const google: Endpoint = { name: "google", url: "https://dns.google/dns-query" };

export const defaults = { endpoints: [cloudflare, google], timeoutMs: 3_000 } as const;

export const make = (
  options: Options = {},
): Effect.Effect<Service, DomainKitError.DomainKitError> =>
  Effect.gen(function* () {
    const endpoints = options.endpoints ?? defaults.endpoints;
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs;
    const fetch = options.fetch ?? globalThis.fetch;
    for (const endpoint of endpoints) {
      if (!URL.canParse(endpoint.url)) {
        return yield* DomainKitError.fail(
          new DomainKitError.InvalidInput({
            message: `Resolver ${endpoint.name} has an invalid URL`,
            field: "endpoints",
          }),
        );
      }
    }
    const one = (endpoint: Endpoint, name: DomainName.DomainName, type: DnsRecord.Type) =>
      Doh.query({ resolver: endpoint.name, url: endpoint.url, fetch, name, type }).pipe(
        Effect.timeout(timeoutMs),
        Effect.match({
          onSuccess: (answer): Outcome => ({
            _tag: "Answered",
            answer: { resolver: endpoint.name, ...answer },
          }),
          onFailure: (failure): Outcome =>
            failure._tag === "TimeoutError"
              ? { _tag: "TimedOut", resolver: endpoint.name }
              : { _tag: "Failed", resolver: endpoint.name, message: failure.message },
        }),
      );
    return {
      resolve: (input, type) =>
        DomainName.decode(input).pipe(
          Effect.match({
            onFailure: (failure): ReadonlyArray<Outcome> =>
              endpoints.map((endpoint) => ({
                _tag: "Failed",
                resolver: endpoint.name,
                message: failure.message,
              })),
            onSuccess: (name) => name,
          }),
          Effect.flatMap((name) =>
            typeof name === "string"
              ? Effect.forEach(endpoints, (endpoint) => one(endpoint, name, type), {
                  concurrency: "unbounded",
                })
              : Effect.succeed(name),
          ),
        ),
    };
  });

/** Cloudflare + Google DoH, 3s timeout. */
export const layer: Layer.Layer<Resolver> = Layer.effect(Resolver)(make().pipe(Effect.orDie));

export const layerWith = (options: Options): Layer.Layer<Resolver, DomainKitError.DomainKitError> =>
  Layer.effect(Resolver)(make(options));
