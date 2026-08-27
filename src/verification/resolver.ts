import { Context, Effect, Layer } from "effect";

import type { DomainName } from "../domain/domain-name.ts";
import type { DnsRecordType } from "../domain/dns-record.ts";
import { ResolverError } from "../errors.ts";

export interface DnsQuery {
  readonly name: DomainName;
  readonly signal?: AbortSignal;
  readonly type: DnsRecordType;
}

export interface DnsAnswer {
  readonly data: string;
  readonly name: DomainName;
  readonly ttl: number;
  readonly type: DnsRecordType;
}

export type DnsResolution =
  | { readonly _tag: "answer"; readonly answers: ReadonlyArray<DnsAnswer> }
  | { readonly _tag: "nodata" };

export interface DnsResolverService {
  readonly resolve: (query: DnsQuery) => Effect.Effect<DnsResolution, ResolverError>;
}

export const DnsResolver = Context.Service<DnsResolverService>("domainkit/DnsResolver");

export type PromiseDnsResolution =
  | DnsResolution
  | { readonly _tag: "timeout" }
  | { readonly _tag: "failure"; readonly message: string };

export interface PromiseDnsResolver {
  readonly resolve: (query: DnsQuery) => Promise<PromiseDnsResolution>;
}

export function layerDnsResolverFromPromise(
  resolver: PromiseDnsResolver,
): Layer.Layer<DnsResolverService> {
  return Layer.succeed(DnsResolver)({
    resolve: (query) =>
      Effect.tryPromise({
        try: () => resolver.resolve(query),
        catch: (cause) =>
          new ResolverError({
            message: cause instanceof Error ? cause.message : String(cause),
            reason: "transport",
          }),
      }).pipe(
        Effect.flatMap((resolution) =>
          resolution._tag === "timeout"
            ? Effect.fail(new ResolverError({ message: "DNS query timed out", reason: "timeout" }))
            : resolution._tag === "failure"
              ? Effect.fail(new ResolverError({ message: resolution.message, reason: "transport" }))
              : Effect.succeed(resolution),
        ),
      ),
  });
}

export function toPromiseDnsResolver(resolver: DnsResolverService): PromiseDnsResolver {
  return {
    resolve: (query) =>
      Effect.runPromise(
        resolver
          .resolve(query)
          .pipe(
            Effect.catch((failure) =>
              Effect.succeed(
                failure.reason === "timeout"
                  ? ({ _tag: "timeout" } as const)
                  : ({ _tag: "failure", message: failure.message } as const),
              ),
            ),
          ),
      ),
  };
}
