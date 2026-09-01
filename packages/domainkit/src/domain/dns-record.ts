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

const RecordSchema = S.TaggedUnion({
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

/** Aggregate DNS requirement schema used for decoding and persistence. */
export { RecordSchema as Schema };

/** Constructs an A record requirement from trusted application data. */
export function A(input: Parameters<typeof RecordSchema.cases.A.make>[0]) {
  return RecordSchema.cases.A.make(input);
}
export namespace A {
  export const Schema = RecordSchema.cases.A;
}

/** Constructs an AAAA record requirement from trusted application data. */
export function Aaaa(input: Parameters<typeof RecordSchema.cases.AAAA.make>[0]) {
  return RecordSchema.cases.AAAA.make(input);
}
export namespace Aaaa {
  export const Schema = RecordSchema.cases.AAAA;
}

/** Constructs a CAA record requirement from trusted application data. */
export function Caa(input: Parameters<typeof RecordSchema.cases.CAA.make>[0]) {
  return RecordSchema.cases.CAA.make(input);
}
export namespace Caa {
  export const Schema = RecordSchema.cases.CAA;
}

/** Constructs a CNAME record requirement from trusted application data. */
export function Cname(input: Parameters<typeof RecordSchema.cases.CNAME.make>[0]) {
  return RecordSchema.cases.CNAME.make(input);
}
export namespace Cname {
  export const Schema = RecordSchema.cases.CNAME;
}

/** Constructs an MX record requirement from trusted application data. */
export function Mx(input: Parameters<typeof RecordSchema.cases.MX.make>[0]) {
  return RecordSchema.cases.MX.make(input);
}
export namespace Mx {
  export const Schema = RecordSchema.cases.MX;
}

/** Constructs an NS record requirement from trusted application data. */
export function Ns(input: Parameters<typeof RecordSchema.cases.NS.make>[0]) {
  return RecordSchema.cases.NS.make(input);
}
export namespace Ns {
  export const Schema = RecordSchema.cases.NS;
}

/** Constructs an SRV record requirement from trusted application data. */
export function Srv(input: Parameters<typeof RecordSchema.cases.SRV.make>[0]) {
  return RecordSchema.cases.SRV.make(input);
}
export namespace Srv {
  export const Schema = RecordSchema.cases.SRV;
}

/** Constructs a TXT record requirement from trusted application data. */
export function Txt(input: Parameters<typeof RecordSchema.cases.TXT.make>[0]) {
  return RecordSchema.cases.TXT.make(input);
}
export namespace Txt {
  export const Schema = RecordSchema.cases.TXT;
}

export type DnsRecord = typeof RecordSchema.Type;
export type Encoded = typeof RecordSchema.Encoded;

/** Provider state that DomainKit cannot create but must retain for safe reconciliation. */
const OpaqueSchema = S.TaggedStruct("Opaque", {
  name: S.String.check(S.isMinLength(1)),
  providerRecordId: S.NullOr(S.String),
  providerType: S.String.check(S.isMinLength(1)),
});

/** Constructs an opaque provider record from trusted adapter data. */
export function Opaque(input: Parameters<typeof OpaqueSchema.make>[0]) {
  return OpaqueSchema.make(input);
}
export namespace Opaque {
  export const Schema = OpaqueSchema;
}
export interface Opaque extends S.Schema.Type<typeof OpaqueSchema> {}

/** Any DNS record observed through a provider, including non-portable record types. */
export const Observed = S.Union([RecordSchema, OpaqueSchema]);
export type Observed = typeof Observed.Type;

export const decode = Effect.fn("DnsRecord.decode")((input: unknown) =>
  S.decodeUnknownEffect(RecordSchema)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export function parse(input: unknown): DnsRecord {
  try {
    return S.decodeUnknownSync(RecordSchema)(input);
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
