/**
 * A principal's consent to apply a specific plan digest. `Provision.apply` and `Cleanup.apply`
 * accept only an Approval. The word "authorization" is reserved for provider OAuth.
 */
import { Effect, Schema } from "effect";

import * as Errors from "./internal/error.ts";
import * as Plan from "./Plan.ts";

export const ApprovalId = Schema.String.pipe(Schema.brand("@domainkit/ApprovalId"));
export type ApprovalId = typeof ApprovalId.Type;

export class Model extends Schema.Class<Model>("@domainkit/Approval")({
  id: ApprovalId,
  version: Schema.Literal("domainkit.approval.v2"),
  kind: Plan.Kind,
  planId: Plan.PlanId,
  digest: Plan.Digest,
  /** Subset of the plan's write operations; the full set unless partial approval was requested. */
  operationIds: Schema.Array(Plan.OperationId),
  approvedBy: Schema.String,
  approvedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
}) {}
export type Encoded = typeof Model.Encoded;

export const decode = (input: unknown): Effect.Effect<Model, Errors.DomainKitError> =>
  Errors.decode(Model, input);
export const encode: (approval: Model) => Encoded = Schema.encodeSync(Model);
