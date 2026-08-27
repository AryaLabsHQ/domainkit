import { Effect, Layer } from "effect";

import * as DnsResolver from "./resolver.ts";

export type Resolve = (
  query: DnsResolver.Query,
) => DnsResolver.Resolution | Effect.Effect<DnsResolver.Resolution, DnsResolver.Error>;

export function make(resolve: Resolve): DnsResolver.Interface {
  return {
    resolve: Effect.fn("InMemoryDnsResolver.resolve")((query) =>
      Effect.suspend(() => {
        const resolution = resolve(query);
        return Effect.isEffect(resolution) ? resolution : Effect.succeed(resolution);
      }),
    ),
  };
}

export const layer = (resolve: Resolve): Layer.Layer<DnsResolver.Service> =>
  Layer.succeed(DnsResolver.Service, make(resolve));

export const toAsync = (resolve: Resolve): DnsResolver.AsyncInterface =>
  DnsResolver.toAsync(make(resolve));
