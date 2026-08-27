import type { DnsQuery, DnsResolution, DnsResolver } from "./resolver.ts";

export class InMemoryDnsResolver implements DnsResolver {
  readonly #resolve: (query: DnsQuery) => DnsResolution | Promise<DnsResolution>;

  constructor(resolve: (query: DnsQuery) => DnsResolution | Promise<DnsResolution>) {
    this.#resolve = resolve;
  }

  async resolve(query: DnsQuery): Promise<DnsResolution> {
    return this.#resolve(query);
  }
}
