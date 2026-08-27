import { Schema } from "effect";

import { InvalidInputError } from "./invalid-input-error.ts";
import { ApplyReceipt } from "./plan/types.ts";

export { InvalidInputError } from "./invalid-input-error.ts";

export class PlanConflictError extends Schema.TaggedError<PlanConflictError>()(
  "PlanConflictError",
  {
    operationIds: Schema.Array(Schema.String),
  },
) {}

export class AuthorizationError extends Schema.TaggedError<AuthorizationError>()(
  "AuthorizationError",
  { message: Schema.String },
) {}

export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  message: Schema.String,
  providerId: Schema.String,
}) {}

export class CryptoError extends Schema.TaggedError<CryptoError>()("CryptoError", {
  message: Schema.String,
}) {}

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  message: Schema.String,
  operation: Schema.String,
}) {}

export class StalePlanError extends Schema.TaggedError<StalePlanError>()("StalePlanError", {
  approvedPlanDigest: Schema.String,
  currentPlanDigest: Schema.String,
}) {}

/** A loud, recoverable failure after one or more approved DNS creates succeeded. */
export class PartialApplyError extends Schema.TaggedError<PartialApplyError>()(
  "PartialApplyError",
  {
    causeTag: Schema.Literals([
      "CryptoError",
      "InvalidInputError",
      "ProviderError",
      "StalePlanError",
    ]),
    failedOperationId: Schema.String,
    message: Schema.String,
    receipt: ApplyReceipt,
  },
) {}

export type DomainKitError =
  | InvalidInputError
  | PlanConflictError
  | AuthorizationError
  | CryptoError
  | StorageError
  | PartialApplyError
  | ProviderError
  | StalePlanError;
