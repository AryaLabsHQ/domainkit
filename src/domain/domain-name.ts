import { Schema } from "effect";

import { InvalidInputError } from "../errors.ts";

const labelPattern = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

const validDomainName = Schema.makeFilter<string>(
  (value) =>
    value.length <= 253 &&
    value.includes(".") &&
    value.split(".").every((label) => labelPattern.test(label))
      ? undefined
      : "Expected a fully qualified DNS name",
  { identifier: "DomainName" },
);

/** A normalized, lower-case, absolute DNS name without a trailing dot. */
export const DomainName = Schema.String.check(validDomainName).pipe(Schema.brand("DomainName"));
export type DomainName = typeof DomainName.Type;

export function parseDomainName(input: string): DomainName {
  try {
    const trimmed = input.trim().replace(/\.+$/, "");
    const labels = trimmed.split(".").map((label) => {
      if (label.includes("_") || [...label].every((character) => character.charCodeAt(0) <= 127)) {
        return label.toLowerCase();
      }
      return new URL(`http://${label}.example`).hostname.split(".")[0]!.toLowerCase();
    });
    return Schema.decodeUnknownSync(DomainName)(labels.join("."));
  } catch (cause) {
    if (cause instanceof InvalidInputError) throw cause;
    throw new InvalidInputError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
