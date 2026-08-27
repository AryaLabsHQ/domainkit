import type { DomainName } from "../domain/domain-name.ts";
import type { DnsRecord } from "../domain/dns-record.ts";
import type { DnsProvider, ProviderCreateResult } from "./provider.ts";

export class InMemoryDnsProvider implements DnsProvider {
  readonly id: string;
  readonly #records = new Map<DomainName, Array<DnsRecord>>();

  constructor(
    options: {
      readonly id?: string;
      readonly records?: Readonly<Record<string, ReadonlyArray<DnsRecord>>>;
    } = {},
  ) {
    this.id = options.id ?? "memory";
    for (const [zone, records] of Object.entries(options.records ?? {})) {
      this.#records.set(zone as DomainName, [...records]);
    }
  }

  async listRecords(zone: DomainName): Promise<ReadonlyArray<DnsRecord>> {
    return [...(this.#records.get(zone) ?? [])];
  }

  async createRecord(zone: DomainName, record: DnsRecord): Promise<ProviderCreateResult> {
    const records = this.#records.get(zone) ?? [];
    records.push(record);
    this.#records.set(zone, records);
    return { providerRecordId: `${this.id}:${records.length}` };
  }
}
