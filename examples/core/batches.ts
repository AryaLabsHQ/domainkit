import { Effect, Match } from "effect";
import { DnsRecord, Provision, type Storage } from "domainkit";

const requirementsFor = (domain: string) => [
  DnsRecord.cname({ name: domain, target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({ name: `_acme.${domain}`, value: "acme-verify=7f3a", purpose: "Prove ownership" }),
];

// #region create
/**
 * Plans every domain at once, with `Policy.batchConcurrency` in flight. The key is unique per
 * owner, so a retried request answers with the batch the first one made.
 */
export const start = Provision.batch.create({
  idempotencyKey: "setup-2026-03-04-a41f",
  items: [
    { domain: "one.example.com", requirements: requirementsFor("one.example.com") },
    { domain: "two.example.com", requirements: requirementsFor("two.example.com") },
  ],
});
// #endregion create

// #region review
/** What a review screen needs: the digest to approve, and where each domain stands. */
export const review = (batch: Provision.Batch) => ({
  digest: batch.digest,
  status: batch.status,
  domains: batch.items.map((item) => ({
    attachmentId: item.attachmentId,
    plan: item.plan,
    status: item.status,
    // The one thing an item owns: an item with no plan has no attempt to carry it.
    planFailure: item.planFailure,
  })),
});
// #endregion review

// #region resume
/**
 * Re-plan the domains that have none. A batch holds pointers, not requirements, so the host
 * supplies them again.
 */
export const resume = (id: Storage.BatchId) =>
  Provision.batch.resumePlanning(id, {
    items: [{ domain: "two.example.com", requirements: requirementsFor("two.example.com") }],
  });
// #endregion resume

// #region approve
/**
 * One consent for the whole batch, bound to the digest the customer read. A digest the batch's
 * current plans no longer produce fails `BatchStale` and writes nothing.
 */
export const approve = (batch: Provision.Batch) =>
  batch.digest === null
    ? Effect.succeed(batch)
    : Provision.batch.approve(batch.id, { digest: batch.digest });
// #endregion approve

// #region apply
/**
 * Applies every approved domain that has no receipt yet. A domain another apply holds waits for
 * the next round, and one that fails does not stop the ones beside it, so calling this again
 * resumes the batch.
 */
export const apply = (id: Storage.BatchId) => Provision.batch.apply(id);
// #endregion apply

// #region list
/** The index behind a "you still owe this" banner: no plan is read, so it stays cheap. */
export const unfinished = Provision.batch.list({ unfinished: true });
// #endregion list

// #region reject
/** Terminal, and it declines every plan under the batch. Only while nothing is approved. */
export const decline = (id: Storage.BatchId) =>
  Provision.batch.reject(id, { reason: "Wrong domains" });
// #endregion reject

// #region failures
export const explain = (batch: Provision.Batch) =>
  Match.value(batch.status).pipe(
    Match.when("planning", () => "Some domains still need a plan; resume planning."),
    Match.when("planned", () => "Ready for the customer to approve."),
    Match.when("approved", () => "Approved; apply it."),
    Match.when("applying", () => "An apply is in flight."),
    Match.when("partial", () => "Some records landed and some did not; re-plan those domains."),
    Match.when("failed", () => "At least one domain stopped before any write; apply again."),
    Match.when("complete", () => "Every domain is done."),
    Match.when("rejected", () => "The customer declined."),
    Match.exhaustive,
  );
// #endregion failures
