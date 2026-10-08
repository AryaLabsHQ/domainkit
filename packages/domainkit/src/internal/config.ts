import { Config, Effect, Redacted } from "effect";

import * as Errors from "./error.ts";
import * as Reason from "../Reason.ts";

/** Accept a literal or a `Config`; config failures surface as `InvalidInput` on `field`. */
export const resolve = <A>(
  value: A | Config.Config<A>,
  field: string,
): Effect.Effect<A, Errors.DomainKitError> =>
  Config.isConfig(value)
    ? value.pipe(
        Effect.mapError(
          () =>
            new Errors.DomainKitError({
              reason: new Reason.InvalidInput({ message: `Could not resolve ${field}`, field }),
            }),
        ),
      )
    : Effect.succeed(value);

/** Configuration diagnostics name the field, never the rejected value. */
export const requireValue = <A>(
  value: A,
  valid: (value: A) => boolean,
  field: string,
  message: string,
): Effect.Effect<A, Errors.DomainKitError> =>
  Effect.suspend(() =>
    valid(value) ? Effect.succeed(value) : Errors.fail(new Reason.InvalidInput({ field, message })),
  );

export const nonempty = (value: string, field: string) =>
  requireValue(
    value,
    (v) => typeof v === "string" && v.trim().length > 0,
    field,
    `${field} must be a nonempty string`,
  );

export const secret = (value: Redacted.Redacted<string>, field: string) =>
  requireValue(
    value,
    (v) =>
      Redacted.isRedacted(v) &&
      typeof Redacted.value(v) === "string" &&
      Redacted.value(v).trim().length > 0,
    field,
    `${field} must be a nonempty Redacted string`,
  );

/** Paths and split emulator origins are supported; URL suffixes must remain paths. */
export const endpoint = (value: string, field: string) =>
  requireValue(
    value,
    (v) => {
      if (
        typeof v !== "string" ||
        v !== v.trim() ||
        [...v].some((character) => character.charCodeAt(0) < 0x20)
      )
        return false;
      const url = URL.parse(v);
      return (
        url !== null &&
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.username === "" &&
        url.password === "" &&
        !url.href.includes("?") &&
        !url.href.includes("#")
      );
    },
    field,
    `${field} must be an HTTP(S) URL without surrounding whitespace, control characters, credentials, query, or fragment`,
  );

export const scopes = (value: ReadonlyArray<string>, field: string) =>
  requireValue(
    value,
    (v) =>
      Array.isArray(v) &&
      v.every((scope) => typeof scope === "string" && /^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope)),
    field,
    `${field} must contain valid OAuth scope tokens`,
  );
