import { Effect, Layer } from "effect";

import type { ResolverError } from "../errors.ts";
import {
  DnsResolver,
  type DnsQuery,
  type DnsResolution,
  type DnsResolverService,
  type PromiseDnsResolver,
  toPromiseDnsResolver,
} from "./resolver.ts";

export class InMemoryDnsResolver implements DnsResolverService {
  readonly #resolve: (
    query: DnsQuery,
  ) => DnsResolution | Effect.Effect<DnsResolution, ResolverError>;

  constructor(
    resolve: (query: DnsQuery) => DnsResolution | Effect.Effect<DnsResolution, ResolverError>,
  ) {
    this.#resolve = resolve;
  }

  resolve(query: DnsQuery): Effect.Effect<DnsResolution, ResolverError> {
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
