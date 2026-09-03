/**
 * The one error every DomainKit operation fails with, published as `DomainKit.Error`. Hosts match
 * on `reason`; `category`, `isRetryable`, and `httpStatus` derive from it. Modelled on `SqlError`
 * and `HttpClientError` in Effect.
 */
import { Effect, Schema } from "effect";

import * as Reason from "../Reason.ts";

export type Category = "request" | "auth" | "plan" | "provider" | "storage" | "internal";

export class DomainKitError extends Schema.TaggedError<DomainKitError>("@domainkit/DomainKitError")(
  "DomainKitError",
  { reason: Schema.suspend(() => Reason.Model) },
) {
  get category(): Category {
    switch (this.reason._tag) {
      case "InvalidInput":
      case "NotFound":
        return "request";
      case "Unauthenticated":
      case "Forbidden":
      case "Reconnect":
        return "auth";
      case "Conflict":
      case "Stale":
      case "Expired":
      case "Busy":
        return "plan";
      case "ProviderRejected":
      case "ProviderUnavailable":
      case "ProviderConflict":
      case "Unsupported":
        return "provider";
      case "StorageFailed":
        return "storage";
      case "CryptoFailed":
      case "ResolverFailed":
        return "internal";
    }
  }

  get isRetryable(): boolean {
    return (
      this.reason._tag === "Busy" ||
      this.reason._tag === "ProviderUnavailable" ||
      this.reason._tag === "StorageFailed"
    );
  }

  /** The HTTP status `domainkit/server` answers with; hosts mapping their own routes use the same table. */
  get httpStatus(): number {
    switch (this.reason._tag) {
      case "InvalidInput":
        return 400;
      case "Unauthenticated":
        return 401;
      case "Forbidden":
      case "Reconnect":
        return 403;
      case "NotFound":
        return 404;
      case "Conflict":
      case "Stale":
      case "Expired":
      case "Busy":
        return 409;
      case "ProviderRejected":
        return 502;
      case "ProviderConflict":
        return 409;
      case "Unsupported":
        return 501;
      case "ProviderUnavailable":
        return 503;
      case "StorageFailed":
      case "CryptoFailed":
      case "ResolverFailed":
        return 500;
    }
  }

  override get message(): string {
    return this.reason.message;
  }
}

export const isDomainKitError = (input: unknown): input is DomainKitError =>
  input instanceof DomainKitError;

/** `Effect.fail(new DomainKitError({ reason }))` shorthand used across the package. */
export const fail = <R extends Reason.Model>(reason: R): Effect.Effect<never, DomainKitError> =>
  Effect.fail(new DomainKitError({ reason }));

/** Decode with any schema, failing with reason `InvalidInput` and the schema's message. */
export const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
  field?: string,
): Effect.Effect<S["Type"], DomainKitError> =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(
      (cause) =>
        new DomainKitError({
          reason: new Reason.InvalidInput({
            message: cause.message,
            ...(field === undefined ? {} : { field }),
          }),
        }),
    ),
  );
