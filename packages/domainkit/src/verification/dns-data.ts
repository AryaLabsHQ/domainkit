import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import type * as DnsRecord from "../domain/dns-record.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";

const CanonicalAddress = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (value) => value.trim().toLowerCase(),
      encode: (value) => value,
    }),
  ),
);

const CanonicalDomain = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformOrFail({
      decode: (value, options) =>
        Effect.try({
          try: () => DomainName.parse(value).toString(),
          catch: (cause) =>
            new SchemaIssue.InvalidValue(
              { message: cause instanceof Error ? cause.message : String(cause) },
              value,
              options,
            ),
        }),
      encode: (value) => Effect.succeed(value),
    }),
  ),
);

const CanonicalMx = tokenizedDomain(2, 1);
const CanonicalSrv = tokenizedDomain(4, 3);

const CanonicalTxt = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (value) => {
        const trimmed = value.trim();
        const chunks = [...trimmed.matchAll(/"((?:\\.|[^"])*)"/g)];
        return chunks.length === 0
          ? trimmed
          : chunks
              .map((match) => (match[1] ?? "").replace(/\\"/g, '"').replace(/\\\\/g, "\\"))
              .join("");
      },
      encode: (value) => value,
    }),
  ),
);

const CanonicalCaa = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (value) => value.trim().replace(/\s+"([\s\S]*)"$/, " $1"),
      encode: (value) => value,
    }),
  ),
);

export function parse(type: DnsRecord.Type, input: unknown): string {
  const schema = (() => {
    switch (type) {
      case "A":
      case "AAAA":
        return CanonicalAddress;
      case "CNAME":
      case "NS":
        return CanonicalDomain;
      case "MX":
        return CanonicalMx;
      case "SRV":
        return CanonicalSrv;
      case "TXT":
        return CanonicalTxt;
      case "CAA":
        return CanonicalCaa;
    }
  })();
  try {
    return Schema.decodeUnknownSync(schema)(input);
  } catch (cause) {
    throw new InvalidInputError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function tokenizedDomain(length: number, domainIndex: number) {
  return Schema.String.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value, options) =>
          Effect.try({
            try: () => {
              const parts = value.trim().split(/\s+/);
              if (parts.length !== length)
                throw new Error("DNS record data has an invalid field count");
              const domain = parts[domainIndex];
              if (domain === undefined) throw new Error("DNS record target is missing");
              parts[domainIndex] = DomainName.parse(domain);
              return parts.join(" ");
            },
            catch: (cause) =>
              new SchemaIssue.InvalidValue(
                { message: cause instanceof Error ? cause.message : String(cause) },
                value,
                options,
              ),
          }),
        encode: (value) => Effect.succeed(value),
      }),
    ),
  );
}
