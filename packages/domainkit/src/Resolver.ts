/**
 * Public DNS observation. The default layer fans out to Cloudflare and Google DNS-over-HTTPS and
 * keeps every answer, so verification can show "found at Cloudflare, missing at Google".
 */
import { Context, Data, Effect, Layer } from "effect";

import type * as DnsRecord from "./DnsRecord.ts";
import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as DomainName from "./DomainName.ts";
import * as Doh from "./internal/doh.ts";
import type { Fetch } from "./internal/http.ts";

export interface Answer {
  readonly resolver: string;
  readonly records: ReadonlyArray<DnsRecord.Observed>;
  readonly negative: boolean;
  readonly ttl: number | null;
}

export type Outcome = Data.TaggedEnum<{
  Answered: { readonly answer: Answer };
  Failed: { readonly resolver: string; readonly message: string };
  TimedOut: { readonly resolver: string };
}>;
export const Outcome = Data.taggedEnum<Outcome>();

export interface Interface {
  /** Never fails: each resolver's outcome is preserved. */
  readonly resolve: (
    name: string,
    type: DnsRecord.Type,
    options?: { readonly signal?: AbortSignal | undefined },
  ) => Effect.Effect<ReadonlyArray<Outcome>>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/Resolver") {}

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

export const make = (options: Options = {}): Effect.Effect<Interface, Errors.DomainKitError> =>
  Effect.gen(function* () {
    const endpoints = options.endpoints ?? defaults.endpoints;
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs;
    const fetch = options.fetch ?? globalThis.fetch;
    for (const endpoint of endpoints) {
      if (!URL.canParse(endpoint.url)) {
        return yield* Errors.fail(
          new Reason.InvalidInput({
            message: `Resolver ${endpoint.name} has an invalid URL`,
            field: "endpoints",
          }),
        );
      }
    }
    const one = (
      endpoint: Endpoint,
      name: DomainName.Model,
      type: DnsRecord.Type,
      signal: AbortSignal | undefined,
    ) =>
      Doh.query({ resolver: endpoint.name, url: endpoint.url, fetch, name, type, signal }).pipe(
        Effect.timeout(timeoutMs),
        Effect.match({
          onSuccess: (answer): Outcome =>
            Outcome.Answered({ answer: { resolver: endpoint.name, ...answer } }),
          onFailure: (failure): Outcome =>
            failure._tag === "TimeoutError"
              ? Outcome.TimedOut({ resolver: endpoint.name })
              : Outcome.Failed({ resolver: endpoint.name, message: failure.message }),
        }),
      );
    return {
      resolve: (input, type, query) =>
        DomainName.decode(input).pipe(
          Effect.match({
            onFailure: (failure): ReadonlyArray<Outcome> =>
              endpoints.map((endpoint) =>
                Outcome.Failed({ resolver: endpoint.name, message: failure.message }),
              ),
            onSuccess: (name) => name,
          }),
          Effect.flatMap((name) =>
            typeof name === "string"
              ? Effect.forEach(endpoints, (endpoint) => one(endpoint, name, type, query?.signal), {
                  concurrency: "unbounded",
                })
              : Effect.succeed(name),
          ),
        ),
    };
  });

/** Cloudflare + Google DoH, 3s timeout. */
export const layer: Layer.Layer<Service> = Layer.effect(Service)(make().pipe(Effect.orDie));

export const layerWith = (options: Options): Layer.Layer<Service, Errors.DomainKitError> =>
  Layer.effect(Service)(make(options));
