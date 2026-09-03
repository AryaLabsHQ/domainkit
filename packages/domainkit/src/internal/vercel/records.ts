import { Effect } from "effect";

import * as DnsRecord from "../../DnsRecord.ts";
import type * as Provider from "../../Provider.ts";
import { rejected } from "../http.ts";
import type * as Protocol from "./protocol.ts";

export const decode = (
  zone: string,
  record: Protocol.Record,
): Effect.Effect<Provider.ObservedRecord> =>
  Effect.sync(() => ({ record: decodeRecord(zone, record), providerRecordId: record.id }));

const decodeRecord = (zone: string, record: Protocol.Record): DnsRecord.Observed => {
  const name = absoluteName(zone, record.name);
  const opaque = new DnsRecord.Opaque({ name, type: record.type, raw: record });
  const ttl = record.ttl === undefined ? {} : { ttl: record.ttl };
  try {
    switch (record.type) {
      case "A":
        return DnsRecord.a({ name, address: record.value, ...ttl });
      case "AAAA":
        return DnsRecord.aaaa({ name, address: record.value, ...ttl });
      case "CNAME":
        return DnsRecord.cname({ name, target: record.value, ...ttl });
      case "NS":
        return DnsRecord.ns({ name, nameserver: record.value, ...ttl });
      case "TXT":
        return DnsRecord.txt({ name, value: record.value, ...ttl });
      case "MX":
        return DnsRecord.mx({
          name,
          exchange: record.value,
          priority: required(record.mxPriority ?? record.priority),
          ...ttl,
        });
      case "CAA": {
        const match = record.value.match(/^(\d{1,3})\s+(\S+)\s+(?:"((?:\\.|[^"])*)"|(\S.*))$/);
        if (match === null) return opaque;
        return DnsRecord.caa({
          name,
          flags: Number(match[1]),
          tag: required(match[2]),
          value: unescapeQuoted(match[3] ?? match[4] ?? ""),
          ...ttl,
        });
      }
      case "SRV": {
        const parts = record.value.trim().split(/\s+/);
        const [priority, weight, port, target] =
          parts.length === 4
            ? parts
            : [String(record.priority ?? ""), parts[0], parts[1], parts[2]];
        return DnsRecord.srv({
          name,
          target: required(target),
          port: Number(port),
          priority: Number(priority),
          weight: Number(weight),
          ...ttl,
        });
      }
      default:
        return opaque;
    }
  } catch {
    return opaque;
  }
};

export const encode = (
  zone: string,
  record: DnsRecord.Model,
): Effect.Effect<Record<string, unknown>, never> =>
  Effect.sync(() => {
    const common = {
      name: relativeName(zone, record.name),
      ...(record.ttl === null ? {} : { ttl: record.ttl }),
      type: record._tag,
    };
    switch (record._tag) {
      case "A":
      case "AAAA":
        return { ...common, value: record.address };
      case "CNAME":
        return { ...common, value: record.target };
      case "NS":
        return { ...common, value: record.nameserver };
      case "TXT":
        return { ...common, value: record.value };
      case "MX":
        return { ...common, mxPriority: record.priority, value: record.exchange };
      case "CAA":
        return {
          ...common,
          value: `${record.flags} ${record.tag} "${escapeQuoted(record.value)}"`,
        };
      case "SRV":
        return {
          ...common,
          srv: {
            port: record.port,
            priority: record.priority,
            target: record.target,
            weight: record.weight,
          },
        };
    }
  });

export const outsideZone = (zone: string, name: string) =>
  rejected("vercel", `DNS record ${name} is outside Vercel zone ${zone}`, "outside-zone");

function absoluteName(zone: string, name: string): string {
  return name === "" || name === "@"
    ? zone
    : name === zone || name.endsWith(`.${zone}`)
      ? name
      : `${name}.${zone}`;
}

function relativeName(zone: string, name: string): string {
  if (name === zone) return "";
  const suffix = `.${zone}`;
  if (!name.endsWith(suffix)) throw new Error(`DNS record ${name} is outside Vercel zone ${zone}`);
  return name.slice(0, -suffix.length);
}

function required<A>(value: A | undefined): A {
  if (value === undefined) throw new Error("Vercel record field is missing");
  return value;
}

function escapeQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\([\\"])/g, "$1");
}
