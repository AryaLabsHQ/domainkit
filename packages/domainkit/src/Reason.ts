/**
 * Why an operation failed. Every `DomainKit.Error` carries exactly one of these as `reason`; hosts
 * match on `reason._tag` and add a reason here rather than a new error class.
 */
import { Schema } from "effect";

import * as Plan from "./Plan.ts";

// Plan imports `internal/error.ts`, which imports this module; read Plan lazily so evaluation
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

export const Model = Schema.Union([
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
export type Model = typeof Model.Type;
