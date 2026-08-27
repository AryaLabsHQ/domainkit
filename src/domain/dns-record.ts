import { Effect, Schema as S } from "effect";

import { Error as InvalidInputError } from "../invalid-input.ts";
import * as DomainName from "./domain-name.ts";

export const Type = S.Literals(["A", "AAAA", "CNAME", "TXT", "MX", "CAA", "NS", "SRV"]);
export type Type = typeof Type.Type;

export const RequirementMetadata = S.Struct({
  ownership: S.String.check(S.isMinLength(1)),
  provenance: S.String.check(S.isMinLength(1)),
  purpose: S.String.check(S.isMinLength(1)),
});
export interface RequirementMetadata extends S.Schema.Type<typeof RequirementMetadata> {}

const CommonFields = {
  metadata: RequirementMetadata,
  name: DomainName.Schema,
  policy: S.Literals(["exclusive", "append"]),
  ttl: S.NullOr(S.Int.check(S.isBetween({ minimum: 60, maximum: 2_147_483_647 }))),
};

const ExclusiveCommonFields = { ...CommonFields, policy: S.Literal("exclusive") };
const Address = S.String.check(
  S.makeFilter((value) => (isIpv4(value) ? undefined : "Expected an IPv4 address")),
);
const Ipv6Address = S.String.check(
  S.makeFilter((value) => (isIpv6(value) ? undefined : "Expected an IPv6 address")),
);
const Port = S.Int.check(S.isBetween({ minimum: 0, maximum: 65_535 }));
const Priority = S.Int.check(S.isBetween({ minimum: 0, maximum: 65_535 }));

export const Schema = S.TaggedUnion({
  A: { ...CommonFields, address: Address },
  AAAA: { ...CommonFields, address: Ipv6Address },
  CNAME: { ...ExclusiveCommonFields, target: DomainName.Schema },
  TXT: { ...CommonFields, value: S.String.check(S.isMinLength(1)) },
  MX: { ...CommonFields, exchange: DomainName.Schema, priority: Priority },
  CAA: {
    ...CommonFields,
    flags: S.Int.check(S.isBetween({ minimum: 0, maximum: 255 })),
    tag: S.Literals(["issue", "issuewild", "iodef"]),
    value: S.String.check(S.isMinLength(1)),
  },
  NS: { ...CommonFields, target: DomainName.Schema },
  SRV: {
    ...CommonFields,
    port: Port,
    priority: Priority,
    target: DomainName.Schema,
    weight: Priority,
  },
});
export const {
  A,
  AAAA: Aaaa,
  CAA: Caa,
  CNAME: Cname,
  MX: Mx,
  NS: Ns,
  SRV: Srv,
  TXT: Txt,
} = Schema.cases;
export type DnsRecord = typeof Schema.Type;
export type Encoded = typeof Schema.Encoded;

export const decode = Effect.fn("DnsRecord.decode")((input: unknown) =>
  S.decodeUnknownEffect(Schema)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export function parse(input: unknown): DnsRecord {
  try {
    return S.decodeUnknownSync(Schema)(input);
  } catch (cause) {
    throw new InvalidInputError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export function data(record: DnsRecord): Readonly<Record<string, number | string>> {
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

export function equals(left: DnsRecord, right: DnsRecord): boolean {
  return (
    left._tag === right._tag &&
    left.name === right.name &&
    JSON.stringify(data(left)) === JSON.stringify(data(right))
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
