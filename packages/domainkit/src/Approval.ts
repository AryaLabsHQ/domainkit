/**
 * A principal's consent to apply a specific plan digest. `Provision.apply` and `Cleanup.apply`
 * accept only an Approval. The word "authorization" is reserved for provider OAuth.
 */
import { Effect, Schema } from "effect";

import * as DomainKitError from "./DomainKitError.ts";
import * as Plan from "./Plan.ts";

export const ApprovalId = Schema.String.pipe(Schema.brand("@domainkit/ApprovalId"));
export type ApprovalId = typeof ApprovalId.Type;

export class Approval extends Schema.Class<Approval>("@domainkit/Approval")({
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
export type Encoded = typeof Approval.Encoded;

export const decode = (input: unknown): Effect.Effect<Approval, DomainKitError.DomainKitError> =>
  DomainKitError.decode(Approval, input);
export const encode: (approval: Approval) => Encoded = Schema.encodeSync(Approval);
