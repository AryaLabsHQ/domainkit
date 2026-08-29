import { Data, Effect, Layer } from "effect";

import type * as DomainName from "../domain/domain-name.ts";
import type * as DnsRecord from "../domain/dns-record.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as DnsResolver from "../verification/resolver.ts";
import * as DnsResolverPoolEffect from "../verification/resolver-pool.ts";
import * as VerificationEffect from "../verification/verify.ts";
import type * as DnsResolverPool from "./resolver-pool.ts";

export type PublicDns = VerificationEffect.PublicDns;
export const PublicDns = VerificationEffect.PublicDns;

export type Provider = Data.TaggedEnum<{
  Disabled: {};
  Enabled: {
    readonly provider: DnsProvider.AsyncInterface;
    readonly zone: DomainName.DomainName;
  };
}>;
export const Provider = Data.taggedEnum<Provider>();

export interface Config {
  readonly provider?: Provider;
  readonly publicDns?: PublicDns;
  readonly record: DnsRecord.DnsRecord;
  readonly resolvers?: ReadonlyArray<DnsResolverPool.Entry>;
}

export { ProviderObservation, PublicDnsObservation, Result } from "../verification/verify.ts";

export function observe(input: Config): Promise<VerificationEffect.Result> {
  const provider = input.provider ?? Provider.Disabled();
  let program =
    provider._tag === "Enabled"
      ? VerificationEffect.observe({
          record: input.record,
          ...(input.publicDns === undefined ? {} : { publicDns: input.publicDns }),
          provider: VerificationEffect.Provider.Enabled({ zone: provider.zone }),
        }).pipe(Effect.provide(DnsProvider.layerFromAsync(provider.provider)))
      : VerificationEffect.observe({
          record: input.record,
          ...(input.publicDns === undefined ? {} : { publicDns: input.publicDns }),
          provider: VerificationEffect.Provider.Disabled(),
        });
  if (input.resolvers !== undefined) {
    program = program.pipe(
      Effect.provide(
        Layer.succeed(
          DnsResolverPoolEffect.Service,
          DnsResolverPoolEffect.make(
            input.resolvers.map((entry) => ({
              id: entry.id,
              resolver: fromAsyncResolver(entry.resolver),
              ...(entry.timeoutMs === undefined ? {} : { timeoutMs: entry.timeoutMs }),
            })),
          ),
        ),
      ),
    );
  }
  return Effect.runPromise(program);
}

function fromAsyncResolver(resolver: DnsResolver.AsyncInterface): DnsResolver.Interface {
  return {
    resolve: (query) =>
      Effect.tryPromise({
        try: () => resolver.resolve(query),
        catch: (cause) =>
          new DnsResolver.Error({
            cause,
            message: cause instanceof globalThis.Error ? cause.message : String(cause),
            reason: "transport",
          }),
      }).pipe(
        Effect.flatMap((resolution) => {
          switch (resolution._tag) {
            case "answer":
            case "nodata":
              return Effect.succeed(resolution);
            case "timeout":
              return Effect.fail(
                new DnsResolver.Error({ message: "DNS query timed out", reason: "timeout" }),
              );
            case "failure":
              return Effect.fail(
                new DnsResolver.Error({ message: resolution.message, reason: "transport" }),
              );
          }
        }),
      ),
  };
}
