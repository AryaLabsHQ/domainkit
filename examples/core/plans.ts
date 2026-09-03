import { Effect, Match } from "effect";
import { DnsRecord, Plan, Provision, Receipt } from "domainkit";

// #region requirements
export const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];
// #endregion requirements

// #region plan
// Reads the attached zone and returns the exact operations, never a write.
export const build = Provision.plan({ domain: "app.example.com", requirements });
// #endregion plan

// #region review
/** What a review screen needs: the writes, the conflicts, and whether apply can run at all. */
export const review = (plan: Plan.Model) => ({
  writes: Plan.writes(plan),
  conflicts: Plan.conflicts(plan),
  applicable: Plan.isApplicable(plan),
  digest: plan.digest,
  expiresAt: plan.expiresAt,
  instructions: Plan.renderInstructions(plan),
});
// #endregion review

// #region approve
/** Approval binds consent to the digest. Without `operationIds` it covers every write. */
export const approveEverything = (plan: Plan.Model) => Provision.approve(plan);

/** Partial approval names the operations and admits that conflicts stay behind. */
export const approveSome = (plan: Plan.Model) =>
  Provision.approve(plan, {
    operationIds: Plan.writes(plan)
      .slice(0, 1)
      .map((operation) => operation.id),
    allowPartial: true,
  });
// #endregion approve

// #region apply
/**
 * Apply re-plans the zone first and fails `Stale` when it moved. Partial success is a receipt with
 * `status: "partial"`, not a failure: re-planning turns the written records into no-ops.
 */
export const applyAndSummarise = Effect.gen(function* () {
  const plan = yield* build;
  const approval = yield* Provision.approve(plan);
  const receipt = yield* Provision.apply(approval);
  return {
    complete: Receipt.isComplete(receipt),
    written: Receipt.applied(receipt).length,
    outcomes: receipt.outcomes.map((outcome) => outcome._tag),
  };
});
// #endregion apply

// #region reject
/** Declining is terminal for that plan and leaves the domain free for a new one. */
export const decline = (plan: Plan.Model) =>
  Provision.reject(plan, { reason: "Customer wants to keep the current CNAME" });
// #endregion reject

// #region resume
/** Plan, consent, and apply can land in three requests; each step replays its own result. */
export const resume = (planId: Plan.PlanId) =>
  Effect.map(Provision.get(planId), (attempt) => ({
    status: attempt.status,
    approved: attempt.approval !== null,
    receipt: attempt.receipt,
    declinedBy: attempt.rejection?.actorId ?? null,
  }));
// #endregion resume

// #region failures
/** Every failure is one `DomainKit.Error`; the reason says what to do next. */
export const explain = applyAndSummarise.pipe(
  Effect.catchTag("DomainKitError", (error) =>
    Match.value(error.reason).pipe(
      Match.tag("Conflict", ({ operations }) =>
        Effect.succeed(`Fix ${operations.length} conflicting record(s) first`),
      ),
      Match.tag("Stale", () => Effect.succeed("The zone moved; build a new plan")),
      Match.tag("Expired", () => Effect.succeed("The plan aged out; build a new one")),
      Match.orElse(() => Effect.succeed(error.message)),
    ),
  ),
);
// #endregion failures
