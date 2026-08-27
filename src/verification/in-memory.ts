import { Effect, Layer } from "effect";

import {
  DnsResolver,
  type DnsQuery,
  type DnsResolution,
  type DnsResolverService,
  type PromiseDnsResolver,
  toPromiseDnsResolver,
} from "./resolver.ts";

export class InMemoryDnsResolver implements DnsResolverService {
  readonly #resolve: (query: DnsQuery) => DnsResolution | Effect.Effect<DnsResolution>;

  constructor(resolve: (query: DnsQuery) => DnsResolution | Effect.Effect<DnsResolution>) {
    this.#resolve = resolve;
  }

  resolve(query: DnsQuery): Effect.Effect<DnsResolution> {
    return Effect.suspend(() => {
      const resolution = this.#resolve(query);
      return Effect.isEffect(resolution) ? resolution : Effect.succeed(resolution);
    });
  }

  get layer(): Layer.Layer<DnsResolverService> {
    return Layer.succeed(DnsResolver)(this);
  }

  get promise(): PromiseDnsResolver {
    return toPromiseDnsResolver(this);
  }
}
