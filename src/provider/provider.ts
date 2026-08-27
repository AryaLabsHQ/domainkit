import type { DomainName } from "../domain/domain-name.ts";
import type { DnsRecord } from "../domain/dns-record.ts";

export interface ProviderCreateResult {
  readonly providerRecordId: string | null;
}

/** The minimal provider seam required by the additive v0.1 interpreter. */
export interface DnsProvider {
  readonly id: string;
  readonly createRecord: (zone: DomainName, record: DnsRecord) => Promise<ProviderCreateResult>;
  readonly listRecords: (zone: DomainName) => Promise<ReadonlyArray<DnsRecord>>;
}
