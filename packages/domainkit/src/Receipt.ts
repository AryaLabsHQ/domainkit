/**
 * What actually happened when an approval was applied. Partial application is a normal outcome
 * carried here as `status: "partial"`, never an error. Cleanup plans are built only from receipts.
 */
import { Effect, Schema } from "effect";

import * as Approval from "./Approval.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as Plan from "./Plan.ts";

export const ReceiptId = Schema.String.pipe(Schema.brand("@domainkit/ReceiptId"));
export type ReceiptId = typeof ReceiptId.Type;

export class Applied extends Schema.TaggedClass<Applied>("@domainkit/Receipt/Applied")("Applied", {
  operationId: Plan.OperationId,
  providerRecordId: Schema.NullOr(Schema.String),
}) {}
/**
 * `noop`: the record already existed. `not-approved`: the approval excluded the operation.
 * `not-attempted`: an earlier operation failed and apply stopped before reaching this one.
 */
export class Skipped extends Schema.TaggedClass<Skipped>("@domainkit/Receipt/Skipped")("Skipped", {
  operationId: Plan.OperationId,
  reason: Schema.Literals(["noop", "not-approved", "not-attempted"]),
}) {}
export class Failed extends Schema.TaggedClass<Failed>("@domainkit/Receipt/Failed")("Failed", {
  operationId: Plan.OperationId,
  message: Schema.String,
}) {}
export const Outcome = Schema.Union([Applied, Skipped, Failed]);
export type Outcome = typeof Outcome.Type;

export class Receipt extends Schema.Class<Receipt>("@domainkit/Receipt")({
  id: ReceiptId,
  version: Schema.Literal("domainkit.receipt.v2"),
  kind: Plan.Kind,
  planId: Plan.PlanId,
  approvalId: Approval.ApprovalId,
  digest: Plan.Digest,
  provider: Schema.String,
  zone: Schema.String,
  status: Schema.Literals(["complete", "partial"]),
  outcomes: Schema.Array(Outcome),
  appliedAt: Schema.DateTimeUtcFromString,
}) {}
export type Encoded = typeof Receipt.Encoded;

export const decode = (input: unknown): Effect.Effect<Receipt, DomainKitError.DomainKitError> =>
  DomainKitError.decode(Receipt, input);
export const encode: (receipt: Receipt) => Encoded = Schema.encodeSync(Receipt);
export const isComplete = (receipt: Receipt): boolean => receipt.status === "complete";

/** Operations the receipt proves were written, with the provider record ids needed to undo them. */
export const applied = (receipt: Receipt): ReadonlyArray<Applied> =>
  receipt.outcomes.filter((outcome): outcome is Applied => outcome._tag === "Applied");
