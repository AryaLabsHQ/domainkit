import { Effect, Schema as S } from "effect";

import * as DomainName from "../../domain/domain-name.ts";
import * as DnsRecord from "../../domain/dns-record.ts";
import * as DnsProvider from "../../provider/provider.ts";
import type * as Protocol from "./protocol.ts";

export type CreateBody = Readonly<Record<string, unknown>>;

export const decode = Effect.fn("VercelRecords.decode")(
  (zone: DomainName.DomainName, record: Protocol.Record) =>
    Effect.gen(function* () {
      const absolute = absoluteNameCandidate(zone, record.name);
      const name = yield* DomainName.decode(absolute).pipe(
        Effect.match({ onFailure: () => null, onSuccess: (value) => value }),
      );
      if (name === null) return yield* decodeOpaque(record, absolute);
      const common = {
        metadata: {
          ownership: "provider",
          provenance: "vercel",
          purpose: "existing DNS record",
        },
        name,
        policy: record.type === "CNAME" ? "exclusive" : "append",
        ttl: record.ttl ?? 60,
      } as const;
      const fromRecord = (input: unknown) =>
        DnsRecord.decode(input).pipe(
          Effect.mapError((cause) => failure("decodeRecord", cause.message)),
        );

      switch (record.type) {
        case "A":
        case "AAAA":
          return yield* fromRecord({ ...common, _tag: record.type, address: record.value });
        case "CNAME":
        case "NS":
          return yield* fromRecord({ ...common, _tag: record.type, target: record.value });
        case "TXT":
          return yield* fromRecord({ ...common, _tag: "TXT", value: record.value });
        case "MX":
          return yield* fromRecord({
            ...common,
            _tag: "MX",
            exchange: record.value,
            priority: record.mxPriority ?? record.priority,
          });
        case "CAA": {
          const match = record.value.match(
            /^(\d{1,3})\s+(issue|issuewild|iodef)\s+(?:"((?:\\.|[^"])*)"|(\S.*))$/,
          );
          if (match === null) {
            return yield* Effect.fail(
              failure("decodeRecord", "Vercel CAA record has an invalid value"),
            );
          }
          return yield* fromRecord({
            ...common,
            _tag: "CAA",
            flags: Number(match[1]),
            tag: match[2],
            value: unescapeQuoted(match[3] ?? match[4] ?? ""),
          });
        }
        case "SRV": {
          const parts = record.value.trim().split(/\s+/);
          const [priority, weight, port, target] =
            parts.length === 4
              ? parts
              : [String(record.priority ?? ""), parts[0], parts[1], parts[2]];
          return yield* fromRecord({
            ...common,
            _tag: "SRV",
            port: Number(port),
            priority: Number(priority),
            target,
            weight: Number(weight),
          });
        }
        default:
          return yield* decodeOpaque(record, name);
      }
    }),
);

const decodeOpaque = Effect.fn("VercelRecords.decodeOpaque")(
  (record: Protocol.Record, name: string) =>
    S.decodeUnknownEffect(DnsRecord.Opaque.Schema)({
      _tag: "Opaque",
      name,
      providerRecordId: record.id,
      providerType: record.type,
    }).pipe(Effect.mapError((cause) => failure("decodeRecord", cause.message))),
);

export function encode(zone: DomainName.DomainName, record: DnsRecord.DnsRecord): CreateBody {
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
    case "NS":
      return { ...common, value: record.target };
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
}

function absoluteNameCandidate(zone: DomainName.DomainName, name: string): string {
  return name === "" || name === "@"
    ? zone
    : name === zone || name.endsWith(`.${zone}`)
      ? name
      : `${name}.${zone}`;
}

function relativeName(zone: DomainName.DomainName, name: DomainName.DomainName): string {
  if (name === zone) return "";
  const suffix = `.${zone}`;
  if (!name.endsWith(suffix)) {
    throw failure("encodeRecord", `DNS record ${name} is outside Vercel zone ${zone}`, {
      reason: "request",
    });
  }
  return name.slice(0, -suffix.length);
}

function escapeQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\([\\"])/g, "$1");
}

function failure(
  operation: string,
  message: string,
  fields: Partial<Pick<DnsProvider.Error, "reason">> = {},
): DnsProvider.Error {
  return new DnsProvider.Error({
    message,
    operation,
    providerId: "vercel",
    reason: fields.reason ?? "response",
  });
}
