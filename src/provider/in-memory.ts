import { Effect, Layer } from "effect";

import type { DomainName } from "../domain/domain-name.ts";
import type { DnsRecord } from "../domain/dns-record.ts";
import {
  DnsProvider,
  type DnsProviderService,
  type PromiseDnsProvider,
  type ProviderCreateResult,
  toPromiseDnsProvider,
} from "./provider.ts";

export class InMemoryDnsProvider implements DnsProviderService {
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

  listRecords(zone: DomainName): Effect.Effect<ReadonlyArray<DnsRecord>> {
    return Effect.sync(() => [...(this.#records.get(zone) ?? [])]);
  }

  createRecord(zone: DomainName, record: DnsRecord): Effect.Effect<ProviderCreateResult> {
    return Effect.sync(() => {
      const records = this.#records.get(zone) ?? [];
      records.push(record);
      this.#records.set(zone, records);
      return { providerRecordId: `${this.id}:${records.length}` };
    });
  }

  get layer(): Layer.Layer<DnsProviderService> {
    return Layer.succeed(DnsProvider)(this);
  }

  get promise(): PromiseDnsProvider {
    return toPromiseDnsProvider(this);
  }
}
