import { Schema } from "effect";

import { InvalidInputError } from "../invalid-input-error.ts";
import { DomainName, parseDomainName } from "./domain-name.ts";

export const DnsRecordType = Schema.Literals([
  "A",
  "AAAA",
  "CNAME",
  "TXT",
  "MX",
  "CAA",
  "NS",
  "SRV",
]);
export type DnsRecordType = typeof DnsRecordType.Type;

export const RequirementMetadata = Schema.Struct({
  ownership: Schema.String.check(Schema.isMinLength(1)),
  provenance: Schema.String.check(Schema.isMinLength(1)),
  purpose: Schema.String.check(Schema.isMinLength(1)),
});
export type RequirementMetadata = typeof RequirementMetadata.Type;

const CommonFields = {
  metadata: RequirementMetadata,
  name: DomainName,
  policy: Schema.Literals(["exclusive", "append"]),
  ttl: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 60, maximum: 2_147_483_647 }))),
};

const Address = Schema.String.check(
  Schema.makeFilter((value) => (isIpv4(value) ? undefined : "Expected an IPv4 address")),
);
const Ipv6Address = Schema.String.check(
  Schema.makeFilter((value) => (isIpv6(value) ? undefined : "Expected an IPv6 address")),
);
const Port = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65_535 }));
const Priority = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65_535 }));

export const ARecord = Schema.TaggedStruct("A", { ...CommonFields, address: Address });
export const AaaaRecord = Schema.TaggedStruct("AAAA", { ...CommonFields, address: Ipv6Address });
export const CnameRecord = Schema.TaggedStruct("CNAME", { ...CommonFields, target: DomainName });
export const TxtRecord = Schema.TaggedStruct("TXT", {
  ...CommonFields,
  value: Schema.String.check(Schema.isMinLength(1)),
});
export const MxRecord = Schema.TaggedStruct("MX", {
  ...CommonFields,
  exchange: DomainName,
  priority: Priority,
});
export const CaaRecord = Schema.TaggedStruct("CAA", {
  ...CommonFields,
  flags: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  tag: Schema.Literals(["issue", "issuewild", "iodef"]),
  value: Schema.String.check(Schema.isMinLength(1)),
});
export const NsRecord = Schema.TaggedStruct("NS", { ...CommonFields, target: DomainName });
export const SrvRecord = Schema.TaggedStruct("SRV", {
  ...CommonFields,
  port: Port,
  priority: Priority,
  target: DomainName,
  weight: Priority,
});

export const DnsRecord = Schema.Union([
  ARecord,
  AaaaRecord,
  CnameRecord,
  TxtRecord,
  MxRecord,
  CaaRecord,
  NsRecord,
  SrvRecord,
]);
export type DnsRecord = typeof DnsRecord.Type;
type InputRecord<Record extends DnsRecord> = Record extends DnsRecord
  ? Omit<Record, "exchange" | "name" | "target"> & { readonly name: string } & (Record extends {
        readonly target: DomainName;
      }
        ? { readonly target: string }
        : {}) &
      (Record extends { readonly exchange: DomainName } ? { readonly exchange: string } : {})
  : never;
export type DnsRecordInput = InputRecord<DnsRecord>;

export function parseDnsRecord<const Input extends DnsRecordInput | DnsRecord>(
  input: Input,
): Extract<DnsRecord, { readonly _tag: Input["_tag"] }>;
export function parseDnsRecord(input: DnsRecordInput | DnsRecord): DnsRecord;
export function parseDnsRecord(input: DnsRecordInput | DnsRecord): DnsRecord {
  try {
    const normalized = {
      ...input,
      name: parseDomainName(input.name),
      ...("target" in input ? { target: parseDomainName(input.target) } : {}),
      ...("exchange" in input ? { exchange: parseDomainName(input.exchange) } : {}),
    };
    const record = Schema.decodeUnknownSync(DnsRecord)(normalized);
    if (record._tag === "CNAME" && record.policy === "append") {
      throw new Error("CNAME requirements must use the exclusive policy");
    }
    return record;
  } catch (cause) {
    throw new InvalidInputError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export function recordData(record: DnsRecord): Readonly<Record<string, number | string>> {
  switch (record._tag) {
    case "A":
    case "AAAA":
      return { address: record.address };
    case "CNAME":
    case "NS":
      return { target: record.target };
    case "TXT":
      return { value: record.value };
    case "MX":
      return { exchange: record.exchange, priority: record.priority };
    case "CAA":
      return { flags: record.flags, tag: record.tag, value: record.value };
    case "SRV":
      return {
        port: record.port,
        priority: record.priority,
        target: record.target,
        weight: record.weight,
      };
  }
}

export function sameRecordData(left: DnsRecord, right: DnsRecord): boolean {
  return (
    left._tag === right._tag &&
    left.name === right.name &&
    JSON.stringify(recordData(left)) === JSON.stringify(recordData(right))
  );
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part,
    )
  );
}

function isIpv6(value: string): boolean {
  try {
    return new URL(`http://[${value}]/`).hostname.startsWith("[");
  } catch {
    return false;
  }
}
