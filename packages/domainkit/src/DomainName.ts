/**
 * A normalized, IDN-aware hostname. Lifecycle inputs accept plain strings and validate them, so
 * most hosts never construct this directly; it exists for hosts that want the brand in their own
 * types.
 */
import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { getDomain } from "tldts";

import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";

const labelPattern = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

const Branded = Schema.String.check(
  Schema.makeFilter<string>(
    (value) => (isNormalized(value) ? undefined : "Expected a fully qualified DNS name"),
    { identifier: "DomainName" },
  ),
).pipe(Schema.brand("@domainkit/DomainName"));

/** Decodes any hostname spelling into its normalized, branded form; encodes back to a string. */
export const Model = Schema.String.pipe(
  Schema.decodeTo(
    Branded,
    SchemaTransformation.transformOrFail({
      decode: (input, options) =>
        Effect.try({
          try: () => normalize(input),
          catch: (cause) =>
            new SchemaIssue.InvalidValue({ message: errorMessage(cause) }, input, options),
        }),
      encode: (domain) => Effect.succeed(domain),
    }),
  ),
);
export type Model = typeof Branded.Type;

/** Validates and normalizes; `None` when the input is not a hostname. */
export const fromString = (input: string): Option.Option<Model> => {
  try {
    return Option.some(normalizeUnsafe(input));
  } catch {
    return Option.none();
  }
};

/** Validates and normalizes; throws `DomainKit.Error` (reason `InvalidInput`) when invalid. */
export const fromStringUnsafe = (input: string): Model => {
  try {
    return normalizeUnsafe(input);
  } catch (cause) {
    throw new Errors.DomainKitError({
      reason: new Reason.InvalidInput({ message: errorMessage(cause), field: "domain" }),
    });
  }
};

/** Validates and normalizes inside Effect; fails with reason `InvalidInput`. */
export const decode = (
  input: string,
  field = "domain",
): Effect.Effect<Model, Errors.DomainKitError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(normalizeUnsafe(input));
    } catch (cause) {
      return Errors.fail(new Reason.InvalidInput({ message: errorMessage(cause), field }));
    }
  });

export const isDomainName = (input: unknown): input is Model =>
  typeof input === "string" && isNormalized(input);

/**
 * Zone candidates from the name itself down to the registrable domain, most specific first:
 * `a.b.example.com` -> `a.b.example.com`, `b.example.com`, `example.com`. Empty when the name has
 * no registrable suffix.
 */
export const candidates = (domain: Model): ReadonlyArray<Model> => {
  const registrable = getDomain(domain, { allowPrivateDomains: true });
  if (registrable === null) return [];
  const labels = domain.split(".");
  const registrableLabels = registrable.split(".").length;
  const values: Array<Model> = [];
  for (let index = 0; index <= labels.length - registrableLabels; index += 1) {
    values.push(labels.slice(index).join(".") as Model);
  }
  return values;
};

/** `true` when `name` is `zone` or a subdomain of it. */
export const isWithin = (name: string, zone: string): boolean =>
  name === zone || name.endsWith(`.${zone}`);

function isNormalized(value: string): boolean {
  return (
    value.length <= 253 &&
    value.includes(".") &&
    value.split(".").every((label) => labelPattern.test(label))
  );
}

function normalizeUnsafe(input: string): Model {
  return normalize(input) as Model;
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
  const value = labels.join(".");
  if (!isNormalized(value)) {
    throw new Error(`Expected a fully qualified DNS name, received ${JSON.stringify(input)}`);
  }
  return value;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
