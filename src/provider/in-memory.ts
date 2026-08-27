import { Effect, Layer } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import type * as DnsRecord from "../domain/dns-record.ts";
import * as DnsProvider from "./provider.ts";

export interface Options {
  readonly id?: string;
  readonly records?: Readonly<Record<string, ReadonlyArray<DnsRecord.DnsRecord>>>;
}

export function make(options: Options = {}): DnsProvider.Interface {
  const id = options.id ?? "memory";
  const records = new Map<DomainName.DomainName, Array<DnsRecord.DnsRecord>>();
  for (const [zone, initial] of Object.entries(options.records ?? {})) {
    records.set(DomainName.parse(zone), [...initial]);
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
        return { providerRecordId: `${id}:${current.length}` };
      }),
    ),
  };
}

export const layer = (options: Options = {}): Layer.Layer<DnsProvider.Service> =>
  Layer.succeed(DnsProvider.Service, make(options));

export const toAsync = (options: Options = {}): DnsProvider.AsyncInterface =>
  DnsProvider.toAsync(make(options));
