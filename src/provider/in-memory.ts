import { Effect, Layer } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import type * as DnsRecord from "../domain/dns-record.ts";
import * as DnsProvider from "./provider.ts";

export interface Options {
  readonly id?: string;
  readonly records?: Readonly<Record<string, ReadonlyArray<DnsRecord.Observed>>>;
}

export function make(options: Options = {}): DnsProvider.Interface {
  const id = options.id ?? "memory";
  const records = new Map<DomainName.DomainName, Array<DnsRecord.Observed>>();
  const recordIds = new Map<string, DnsRecord.Observed>();
  for (const [zone, initial] of Object.entries(options.records ?? {})) {
    records.set(DomainName.parse(zone), [...initial]);
    for (const [index, record] of initial.entries()) recordIds.set(`${id}:${index + 1}`, record);
  }
  return {
    id,
    listRecords: Effect.fn("InMemoryDnsProvider.listRecords")((zone) =>
      Effect.sync(() => [...(records.get(zone) ?? [])]),
    ),
    createRecord: Effect.fn("InMemoryDnsProvider.createRecord")((zone, record) =>
      Effect.sync(() => {
        const current = records.get(zone) ?? [];
        current.push(record);
        records.set(zone, current);
        const providerRecordId = `${id}:${current.length}`;
        recordIds.set(providerRecordId, record);
        return { providerRecordId };
      }),
    ),
    deleteRecord: Effect.fn("InMemoryDnsProvider.deleteRecord")((zone, providerRecordId) =>
      Effect.sync(() => {
        const record = recordIds.get(providerRecordId);
        if (record === undefined) return;
        records.set(
          zone,
          (records.get(zone) ?? []).filter((candidate) => candidate !== record),
        );
        recordIds.delete(providerRecordId);
      }),
    ),
    getRecord: Effect.fn("InMemoryDnsProvider.getRecord")((_zone, providerRecordId) =>
      Effect.sync(() => recordIds.get(providerRecordId) ?? null),
    ),
  };
}

export const layer = (options: Options = {}): Layer.Layer<DnsProvider.Service> =>
  Layer.succeed(DnsProvider.Service, make(options));

export const toAsync = (options: Options = {}): DnsProvider.AsyncInterface =>
  DnsProvider.toAsync(make(options));
