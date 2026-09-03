/**
 * DNS record requirements a product asks a customer to satisfy, and the observed records a
 * provider or resolver reports back.
 *
 * Constructors are lowercase functions (`DnsRecord.cname(...)`), Effect style. `policy` defaults
 * to `exclusive` for CNAME and `append` for everything else; `ttl` defaults to `null` (provider
 * default); `purpose` is an optional human label the UI shows.
 */
import { Schema } from "effect";

import * as DomainName from "./DomainName.ts";

// DomainName, internal/error, Reason, Plan, and DnsRecord form an import cycle. Field schemas
// that cross it are read lazily so any module can be the first one evaluated.
const Name = Schema.suspend(() => DomainName.Model);

export const Type = Schema.Literals(["A", "AAAA", "CNAME", "TXT", "MX", "CAA", "NS", "SRV"]);
export type Type = typeof Type.Type;

export const Policy = Schema.Literals(["exclusive", "append"]);
export type Policy = typeof Policy.Type;

const Ttl = Schema.NullOr(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 })),
);
const Port = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65_535 }));
const Priority = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65_535 }));
const Ipv4 = Schema.String.check(
  Schema.makeFilter<string>((value) => (isIpv4(value) ? undefined : "Expected an IPv4 address")),
);
const Ipv6 = Schema.String.check(
  Schema.makeFilter<string>((value) => (isIpv6(value) ? undefined : "Expected an IPv6 address")),
);
const NonEmpty = Schema.String.check(Schema.isMinLength(1));

const Common = {
  name: Name,
  ttl: Ttl,
  policy: Policy,
  purpose: Schema.optionalKey(Schema.String),
};

export class A extends Schema.TaggedClass<A>("@domainkit/DnsRecord/A")("A", {
  ...Common,
  address: Ipv4,
}) {}
export class AAAA extends Schema.TaggedClass<AAAA>("@domainkit/DnsRecord/AAAA")("AAAA", {
  ...Common,
  address: Ipv6,
}) {}
export class CNAME extends Schema.TaggedClass<CNAME>("@domainkit/DnsRecord/CNAME")("CNAME", {
  ...Common,
  target: Name,
}) {}
export class TXT extends Schema.TaggedClass<TXT>("@domainkit/DnsRecord/TXT")("TXT", {
  ...Common,
  value: NonEmpty,
}) {}
export class MX extends Schema.TaggedClass<MX>("@domainkit/DnsRecord/MX")("MX", {
  ...Common,
  exchange: Name,
  priority: Priority,
}) {}
export class CAA extends Schema.TaggedClass<CAA>("@domainkit/DnsRecord/CAA")("CAA", {
  ...Common,
  flags: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  tag: NonEmpty,
  value: NonEmpty,
}) {}
export class NS extends Schema.TaggedClass<NS>("@domainkit/DnsRecord/NS")("NS", {
  ...Common,
  nameserver: Name,
}) {}
export class SRV extends Schema.TaggedClass<SRV>("@domainkit/DnsRecord/SRV")("SRV", {
  ...Common,
  target: Name,
  port: Port,
  priority: Priority,
  weight: Priority,
}) {}

export const Model = Schema.Union([A, AAAA, CNAME, TXT, MX, CAA, NS, SRV]);
export type Model = typeof Model.Type;
export type Encoded = typeof Model.Encoded;

/** A provider record DomainKit cannot model but must not overwrite. */
export class Opaque extends Schema.TaggedClass<Opaque>("@domainkit/DnsRecord/Opaque")("Opaque", {
  name: Schema.String,
  type: Schema.String,
  raw: Schema.Unknown,
}) {}
export const Observed = Schema.Union([Model, Opaque]);
export type Observed = typeof Observed.Type;

type Options = { readonly ttl?: number; readonly policy?: Policy; readonly purpose?: string };

const common = (name: string, options: Options, defaultPolicy: Policy) => ({
  name: DomainName.fromStringUnsafe(name),
  ttl: options.ttl ?? null,
  policy: options.policy ?? defaultPolicy,
  ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
});

export const a = (input: { readonly name: string; readonly address: string } & Options): A =>
  new A({ ...common(input.name, input, "append"), address: input.address });
export const aaaa = (input: { readonly name: string; readonly address: string } & Options): AAAA =>
  new AAAA({ ...common(input.name, input, "append"), address: input.address });
export const cname = (
  input: { readonly name: string; readonly target: string } & Omit<Options, "policy">,
): CNAME =>
  new CNAME({
    ...common(input.name, input, "exclusive"),
    target: DomainName.fromStringUnsafe(input.target),
  });
export const txt = (input: { readonly name: string; readonly value: string } & Options): TXT =>
  new TXT({ ...common(input.name, input, "append"), value: input.value });
export const mx = (
  input: { readonly name: string; readonly exchange: string; readonly priority: number } & Options,
): MX =>
  new MX({
    ...common(input.name, input, "append"),
    exchange: DomainName.fromStringUnsafe(input.exchange),
    priority: input.priority,
  });
export const caa = (
  input: {
    readonly name: string;
    readonly flags: number;
    readonly tag: string;
    readonly value: string;
  } & Options,
): CAA =>
  new CAA({
    ...common(input.name, input, "append"),
    flags: input.flags,
    tag: input.tag,
    value: input.value,
  });
export const ns = (input: { readonly name: string; readonly nameserver: string } & Options): NS =>
  new NS({
    ...common(input.name, input, "append"),
    nameserver: DomainName.fromStringUnsafe(input.nameserver),
  });
export const srv = (
  input: {
    readonly name: string;
    readonly target: string;
    readonly port: number;
    readonly priority: number;
    readonly weight: number;
  } & Options,
): SRV =>
  new SRV({
    ...common(input.name, input, "append"),
    target: DomainName.fromStringUnsafe(input.target),
    port: input.port,
    priority: input.priority,
    weight: input.weight,
  });

export const isDnsRecord = (input: unknown): input is Model => Schema.is(Model)(input);

/** The record's data portion as a canonical string, for display and zone-file rendering. */
export const data = (record: Model): string => {
  switch (record._tag) {
    case "A":
    case "AAAA":
      return record.address;
    case "CNAME":
      return record.target;
    case "NS":
      return record.nameserver;
    case "TXT":
      return record.value;
    case "MX":
      return `${record.priority} ${record.exchange}`;
    case "CAA":
      return `${record.flags} ${record.tag} ${record.value}`;
    case "SRV":
      return `${record.priority} ${record.weight} ${record.port} ${record.target}`;
  }
};

/**
 * Structural equality over type, name, and data. `ttl`, `policy`, and `purpose` are requirement
 * metadata, not record identity, so they are ignored; TTL drift is reported on plan operations.
 */
export const equals = (left: Observed, right: Observed): boolean => {
  if (left._tag === "Opaque" || right._tag === "Opaque") {
    return (
      left._tag === "Opaque" &&
      right._tag === "Opaque" &&
      left.name === right.name &&
      left.type === right.type &&
      JSON.stringify(left.raw) === JSON.stringify(right.raw)
    );
  }
  return left._tag === right._tag && left.name === right.name && data(left) === data(right);
};

/** `true` when both records occupy the same name and type, regardless of data. */
export const sameSet = (left: Observed, right: Observed): boolean =>
  left.name === right.name &&
  (left._tag === "Opaque" ? left.type : left._tag) ===
    (right._tag === "Opaque" ? right.type : right._tag);

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
