import { Effect, Schema as S, SchemaIssue, SchemaTransformation } from "effect";

import { Error as InvalidInputError } from "../invalid-input.ts";

const labelPattern = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

const Type = S.String.check(
  S.makeFilter<string>(
    (value) =>
      value.length <= 253 &&
      value.includes(".") &&
      value.split(".").every((label) => labelPattern.test(label))
        ? undefined
        : "Expected a fully qualified DNS name",
    { identifier: "DomainName" },
  ),
).pipe(S.brand("DomainName"));

/** A lower-case, fully qualified DNS name without a trailing dot. */
export type DomainName = typeof Type.Type;

/** Decodes user and wire strings into canonical domain names. */
export const Schema = S.String.pipe(
  S.decodeTo(
    Type,
    SchemaTransformation.transformOrFail({
      decode: (input, options) =>
        Effect.try({
          try: () => normalize(input),
          catch: (cause) =>
            new SchemaIssue.InvalidValue(
              { message: cause instanceof Error ? cause.message : String(cause) },
              input,
              options,
            ),
        }),
      encode: (domain) => Effect.succeed(domain),
    }),
  ),
);

export const decode = Effect.fn("DomainName.decode")((input: unknown) =>
  S.decodeUnknownEffect(Schema)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export function parse(input: unknown): DomainName {
  try {
    return S.decodeUnknownSync(Schema)(input);
  } catch (cause) {
    throw new InvalidInputError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function normalize(input: string): string {
  const labels = input
    .trim()
    .replace(/\.+$/, "")
    .split(".")
    .map((label) => {
      if (label.includes("_") || [...label].every((character) => character.charCodeAt(0) <= 127)) {
        return label.toLowerCase();
      }
      const hostname = new URL(`http://${label}.example`).hostname;
      const normalized = hostname.split(".")[0];
      if (normalized === undefined) throw new Error("Domain label could not be normalized");
      return normalized.toLowerCase();
    });
  return labels.join(".");
}
