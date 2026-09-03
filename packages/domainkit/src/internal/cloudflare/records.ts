import { Effect, Schema as S } from "effect";

import * as DnsRecord from "../../DnsRecord.ts";
import * as DomainName from "../../DomainName.ts";
import type * as Provider from "../../Provider.ts";
import type * as Protocol from "./protocol.ts";

const Data = S.Struct({
  flags: S.optionalKey(S.Number),
  port: S.optionalKey(S.Number),
  priority: S.optionalKey(S.Number),
  tag: S.optionalKey(S.String),
  target: S.optionalKey(S.String),
  value: S.optionalKey(S.String),
  weight: S.optionalKey(S.Number),
});

/** Records DomainKit cannot model, or cannot parse, come back opaque so plans never touch them. */
export const decode = (record: Protocol.Record): Effect.Effect<Provider.ObservedRecord> =>
  Effect.map(decodeRecord(record), (observed) => ({
    record: observed,
    providerRecordId: record.id,
  }));

const decodeRecord = (record: Protocol.Record): Effect.Effect<DnsRecord.Observed> => {
  const opaque = new DnsRecord.Opaque({ name: record.name, type: record.type, raw: record });
  const ttl = record.ttl === 1 ? null : record.ttl;
  const content = record.content;
  const attempt = (): DnsRecord.Observed => {
    switch (record.type) {
      case "A":
        return DnsRecord.a({ name: record.name, address: required(content), ...ttlOption(ttl) });
      case "AAAA":
        return DnsRecord.aaaa({ name: record.name, address: required(content), ...ttlOption(ttl) });
      case "CNAME":
        return DnsRecord.cname({ name: record.name, target: required(content), ...ttlOption(ttl) });
      case "NS":
        return DnsRecord.ns({
          name: record.name,
          nameserver: required(content),
          ...ttlOption(ttl),
        });
      case "TXT":
        return DnsRecord.txt({
          name: record.name,
          value: unquote(required(content)),
          ...ttlOption(ttl),
        });
      case "MX":
        return DnsRecord.mx({
          name: record.name,
          exchange: required(content),
          priority: required(record.priority),
          ...ttlOption(ttl),
        });
      case "CAA": {
        const data = S.decodeUnknownSync(Data)(record.data);
        return DnsRecord.caa({
          name: record.name,
          flags: required(data.flags),
          tag: required(data.tag),
          value: required(data.value),
          ...ttlOption(ttl),
        });
      }
      case "SRV": {
        const data = S.decodeUnknownSync(Data)(record.data);
        return DnsRecord.srv({
          name: record.name,
          target: required(data.target),
          port: required(data.port),
          priority: required(data.priority),
          weight: required(data.weight),
          ...ttlOption(ttl),
        });
      }
      default:
        return opaque;
    }
  };
  return Effect.sync(() => {
    try {
      return attempt();
    } catch {
      return opaque;
    }
  });
};

export const encode = (record: DnsRecord.DnsRecord): Record<string, unknown> => {
  const common = { name: record.name, proxied: false, ttl: record.ttl ?? 1, type: record._tag };
  switch (record._tag) {
    case "A":
    case "AAAA":
      return { ...common, content: record.address };
    case "CNAME":
      return { ...common, content: record.target };
    case "NS":
      return { ...common, content: record.nameserver };
    case "TXT":
      return { ...common, content: record.value };
    case "MX":
      return { ...common, content: record.exchange, priority: record.priority };
    case "CAA":
      return { ...common, data: { flags: record.flags, tag: record.tag, value: record.value } };
    case "SRV":
      return {
        ...common,
        data: {
          port: record.port,
          priority: record.priority,
          target: record.target,
          weight: record.weight,
        },
      };
  }
};

export const isWithinZone = (name: string, zone: string): boolean =>
  DomainName.isWithin(name, zone);

function required<A>(value: A | undefined): A {
  if (value === undefined) throw new Error("Cloudflare record field is missing");
  return value;
}

function ttlOption(ttl: number | null): { readonly ttl?: number } {
  return ttl === null ? {} : { ttl };
}

function unquote(value: string): string {
  const chunks = [...value.matchAll(/"((?:\\.|[^"])*)"/g)];
  return chunks.length === 0
    ? value
    : chunks.map((match) => (match[1] ?? "").replace(/\\"/g, '"').replace(/\\\\/g, "\\")).join("");
}
