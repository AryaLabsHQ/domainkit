import { Effect } from "effect";
import { Cleanup, Plan, type Receipt } from "domainkit";

// #region plan
/**
 * Cleanup is planned from an apply receipt, never from requirements. Each applied record is read
 * back by its provider record id: still an exact match becomes `Delete`, anything else `Conflict`.
 */
export const planFromReceipt = (receiptId: Receipt.ReceiptId) => Cleanup.plan({ receiptId });

/** Or from the domain, which uses its latest provisioning receipt. */
export const planLatest = Cleanup.plan({ domain: "app.example.com" });
// #endregion plan

// #region review
/** A record someone edited by hand is a conflict, so cleanup leaves it alone. */
export const review = (plan: Plan.Model) => ({
  deletes: Plan.writes(plan).length,
  leaveAlone: Plan.conflicts(plan).map((conflict) => ({
    record: conflict.record.name,
    reason: conflict.reason,
  })),
});
// #endregion review

// #region apply
/** Cleanup has its own approval and its own receipt under the same attempt rules. */
export const remove = (receiptId: Receipt.ReceiptId) =>
  Effect.gen(function* () {
    const plan = yield* Cleanup.plan({ receiptId });
    const approval = yield* Cleanup.approve(plan);
    return yield* Cleanup.apply(approval);
  });
// #endregion apply

// #region reject
export const keepRecords = (plan: Plan.Model) =>
  Cleanup.reject(plan, { reason: "Customer still points traffic at these records" });
// #endregion reject
