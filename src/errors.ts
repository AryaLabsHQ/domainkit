import { Schema } from "effect";

export class InvalidInputError extends Schema.TaggedError<InvalidInputError>()(
  "InvalidInputError",
  {
    message: Schema.String,
  },
) {}

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

export class StalePlanError extends Schema.TaggedError<StalePlanError>()("StalePlanError", {
  approvedPlanDigest: Schema.String,
  currentPlanDigest: Schema.String,
}) {}

export type DomainKitError =
  | InvalidInputError
  | PlanConflictError
  | AuthorizationError
  | ProviderError
  | StalePlanError;
