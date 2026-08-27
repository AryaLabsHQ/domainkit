import type { DomainName } from "../domain/domain-name.ts";
import type { DnsRecordType } from "../domain/dns-record.ts";

export interface DnsQuery {
  readonly name: DomainName;
  readonly signal?: AbortSignal;
  readonly type: DnsRecordType;
}

export interface DnsAnswer {
  readonly data: string;
  readonly name: DomainName;
  readonly ttl: number;
  readonly type: DnsRecordType;
}

export type DnsResolution =
  | { readonly _tag: "answer"; readonly answers: ReadonlyArray<DnsAnswer> }
  | { readonly _tag: "nodata" }
  | { readonly _tag: "timeout" }
  | { readonly _tag: "failure"; readonly message: string };

export interface DnsResolver {
  readonly resolve: (query: DnsQuery) => Promise<DnsResolution>;
}
