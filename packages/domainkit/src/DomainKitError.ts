/**
 * The one error every DomainKit operation fails with. Hosts catch `DomainKitError` and match on
 * `reason`; `category`, `isRetryable`, and `httpStatus` derive from the reason. Modelled on
 * `SqlError` and `HttpClientError` in Effect.
 */
import { Effect, Schema } from "effect";

import * as Plan from "./Plan.ts";

// Plan and DnsRecord import this module for `fromStringUnsafe`; read Plan lazily so evaluation
// order inside the cycle does not matter.
const PlanId = Schema.suspend(() => Plan.PlanId);
const Digest = Schema.suspend(() => Plan.Digest);
const Conflicts = Schema.suspend(() => Schema.Array(Plan.Conflict));

export class InvalidInput extends Schema.TaggedError<InvalidInput>(
  "@domainkit/Reason/InvalidInput",
)("InvalidInput", { message: Schema.String, field: Schema.optionalKey(Schema.String) }) {}
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>(
  "@domainkit/Reason/Unauthenticated",
)("Unauthenticated", { message: Schema.String }) {}
export class Forbidden extends Schema.TaggedError<Forbidden>("@domainkit/Reason/Forbidden")(
  "Forbidden",
  { message: Schema.String },
) {}
export class NotFound extends Schema.TaggedError<NotFound>("@domainkit/Reason/NotFound")(
  "NotFound",
  {
    entity: Schema.Literals([
      "connection",
      "attachment",
      "plan",
      "approval",
      "receipt",
      "continuation",
      "provider",
      "zone",
      "authorization",
      "record",
    ]),
    id: Schema.String,
  },
) {
  override get message(): string {
    return `${this.entity} ${this.id} was not found`;
  }
}
/** The plan contains conflicts and cannot be applied. */
export class Conflict extends Schema.TaggedError<Conflict>("@domainkit/Reason/Conflict")(
  "Conflict",
  {
    planId: PlanId,
    operations: Conflicts,
  },
) {
  override get message(): string {
    return `plan ${this.planId} has ${this.operations.length} conflicting operation(s)`;
  }
}
/** Provider state moved since the plan was built; build a new plan. */
export class Stale extends Schema.TaggedError<Stale>("@domainkit/Reason/Stale")("Stale", {
  planId: PlanId,
  digest: Digest,
}) {
  override get message(): string {
    return `plan ${this.planId} is stale; provider state no longer matches digest ${this.digest}`;
  }
}
export class Expired extends Schema.TaggedError<Expired>("@domainkit/Reason/Expired")("Expired", {
  entity: Schema.Literals(["plan", "approval", "continuation", "credential"]),
  id: Schema.String,
}) {
  override get message(): string {
    return `${this.entity} ${this.id} has expired`;
  }
}
/** Another operation holds the lock (e.g. concurrent apply or refresh). Retrying is safe. */
export class Busy extends Schema.TaggedError<Busy>("@domainkit/Reason/Busy")("Busy", {
  key: Schema.String,
}) {
  override get message(): string {
    return `${this.key} is busy`;
  }
}
export class ProviderRejected extends Schema.TaggedError<ProviderRejected>(
  "@domainkit/Reason/ProviderRejected",
)("ProviderRejected", {
  provider: Schema.String,
  code: Schema.optionalKey(Schema.String),
  message: Schema.String,
}) {}
export class ProviderUnavailable extends Schema.TaggedError<ProviderUnavailable>(
  "@domainkit/Reason/ProviderUnavailable",
)("ProviderUnavailable", {
  provider: Schema.String,
  retryAfterMs: Schema.optionalKey(Schema.Number),
  message: Schema.String,
}) {}
/** The provider credential no longer works; the customer must reconnect. */
export class Reconnect extends Schema.TaggedError<Reconnect>("@domainkit/Reason/Reconnect")(
  "Reconnect",
  { provider: Schema.String, connectionId: Schema.String },
) {
  override get message(): string {
    return `${this.provider} connection ${this.connectionId} must be reconnected`;
  }
}
export class StorageFailed extends Schema.TaggedError<StorageFailed>(
  "@domainkit/Reason/StorageFailed",
)("StorageFailed", { operation: Schema.String, message: Schema.String }) {}
export class CryptoFailed extends Schema.TaggedError<CryptoFailed>(
  "@domainkit/Reason/CryptoFailed",
)("CryptoFailed", { operation: Schema.Literals(["digest", "seal", "open"]) }) {
  override get message(): string {
    return `crypto ${this.operation} failed`;
  }
}
export class ResolverFailed extends Schema.TaggedError<ResolverFailed>(
  "@domainkit/Reason/ResolverFailed",
)("ResolverFailed", { resolver: Schema.String, message: Schema.String }) {}

/** The provider refused the write because a conflicting record already exists there. */
export class ProviderConflict extends Schema.TaggedError<ProviderConflict>(
  "@domainkit/Reason/ProviderConflict",
)("ProviderConflict", {
  provider: Schema.String,
  code: Schema.optionalKey(Schema.String),
  message: Schema.String,
}) {}
/** The provider, or this target within it, cannot do the requested operation. */
export class Unsupported extends Schema.TaggedError<Unsupported>("@domainkit/Reason/Unsupported")(
  "Unsupported",
  { provider: Schema.String, operation: Schema.String, message: Schema.String },
) {}

export const Reason = Schema.Union([
  InvalidInput,
  Unauthenticated,
  Forbidden,
  NotFound,
  Conflict,
  Stale,
  Expired,
  Busy,
  ProviderRejected,
  ProviderUnavailable,
  ProviderConflict,
  Unsupported,
  Reconnect,
  StorageFailed,
  CryptoFailed,
  ResolverFailed,
]);
export type Reason = typeof Reason.Type;

export type Category = "request" | "auth" | "plan" | "provider" | "storage" | "internal";

export class DomainKitError extends Schema.TaggedError<DomainKitError>("@domainkit/DomainKitError")(
  "DomainKitError",
  { reason: Reason },
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
export const fail = <R extends Reason>(reason: R): Effect.Effect<never, DomainKitError> =>
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
          reason: new InvalidInput({
            message: cause.message,
            ...(field === undefined ? {} : { field }),
          }),
        }),
    ),
  );
