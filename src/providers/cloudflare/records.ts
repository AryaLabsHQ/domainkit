import { Effect, Schema as S } from "effect";

import * as DomainName from "../../domain/domain-name.ts";
import * as DnsRecord from "../../domain/dns-record.ts";
import * as DnsProvider from "../../provider/provider.ts";
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

export type CreateBody = Readonly<Record<string, unknown>>;

export const decode = Effect.fn("CloudflareRecords.decode")((record: Protocol.Record) =>
  Effect.gen(function* () {
    const name = yield* DomainName.decode(record.name).pipe(
      Effect.match({ onFailure: () => null, onSuccess: (value) => value }),
    );
    if (name === null) return yield* decodeOpaque(record);
    const common = {
      metadata: {
        ownership: "provider",
        provenance: record.proxied === true ? "cloudflare:proxied" : "cloudflare",
        purpose: "existing DNS record",
      },
      name,
      policy: record.type === "CNAME" ? "exclusive" : "append",
      ttl: record.ttl === 1 ? null : record.ttl,
    } as const;
    const content = () =>
      record.content === undefined
        ? Effect.fail(failure("decodeRecord", `Cloudflare ${record.type} record has no content`))
        : Effect.succeed(record.content);

    switch (record.type) {
      case "A":
      case "AAAA":
        return yield* DnsRecord.decode({
          ...common,
          _tag: record.type,
          address: yield* content(),
        }).pipe(Effect.mapError((cause) => failure("decodeRecord", cause.message)));
      case "CNAME":
      case "NS":
        return yield* DnsRecord.decode({
          ...common,
          _tag: record.type,
          target: yield* content(),
        }).pipe(Effect.mapError((cause) => failure("decodeRecord", cause.message)));
      case "TXT":
        return yield* DnsRecord.decode({
          ...common,
          _tag: "TXT",
          value: yield* content(),
        }).pipe(Effect.mapError((cause) => failure("decodeRecord", cause.message)));
      case "MX":
        return yield* DnsRecord.decode({
          ...common,
          _tag: "MX",
          exchange: yield* content(),
          priority: record.priority,
        }).pipe(Effect.mapError((cause) => failure("decodeRecord", cause.message)));
      case "CAA": {
        const data = yield* decodeData(record);
        return yield* DnsRecord.decode({ ...common, _tag: "CAA", ...data }).pipe(
          Effect.mapError((cause) => failure("decodeRecord", cause.message)),
        );
      }
      case "SRV": {
        const data = yield* decodeData(record);
        return yield* DnsRecord.decode({ ...common, _tag: "SRV", ...data }).pipe(
          Effect.mapError((cause) => failure("decodeRecord", cause.message)),
        );
      }
      default:
        return yield* decodeOpaque(record);
    }
  }),
);

const decodeOpaque = Effect.fn("CloudflareRecords.decodeOpaque")((record: Protocol.Record) =>
  S.decodeUnknownEffect(DnsRecord.Opaque)({
    _tag: "Opaque",
    name: record.name,
    providerRecordId: record.id,
    providerType: record.type,
  }).pipe(Effect.mapError((cause) => failure("decodeRecord", cause.message))),
);

export function encode(record: DnsRecord.DnsRecord): CreateBody {
  const common = {
    name: record.name,
    proxied: false,
    ttl: record.ttl ?? 1,
    type: record._tag,
  };
  switch (record._tag) {
    case "A":
    case "AAAA":
      return { ...common, content: record.address };
    case "CNAME":
    case "NS":
      return { ...common, content: record.target };
    case "TXT":
      return { ...common, content: record.value };
    case "MX":
      return { ...common, content: record.exchange, priority: record.priority };
    case "CAA":
      return {
        ...common,
        data: { flags: record.flags, tag: record.tag, value: record.value },
      };
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
}

const decodeData = Effect.fn("CloudflareRecords.decodeData")((record: Protocol.Record) =>
  S.decodeUnknownEffect(Data)(record.data).pipe(
    Effect.mapError((cause) => failure("decodeRecord", cause.message)),
  ),
);

function failure(
  operation: string,
  message: string,
  fields: Partial<Pick<DnsProvider.Error, "reason">> = {},
): DnsProvider.Error {
  return new DnsProvider.Error({
    message,
    operation,
    providerId: "cloudflare",
    reason: fields.reason ?? "response",
  });
}
