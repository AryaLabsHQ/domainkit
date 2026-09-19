# 0011: The batch is an aggregate over attempts

## Status

Accepted

## Context

A customer who moves several domains at once reviews them as one thing. They pick the domains, read
what each one would change, approve the set, and watch it land. Planning is per-domain and touches a
provider, so some domains fail while others succeed; the customer leaves and comes back; the browser
retries the create; two tabs press apply. Nothing about that is specific to one product.

`Storage.attempts` already holds one domain's plan, approval, receipt, lease, and failure, with
replay and a lease that makes apply resumable. What it does not hold is the set: which domains were
chosen together, one digest over their plans, one consent, and an owner-scoped index of what a
customer still owes a move on. Hosts were rebuilding exactly that, with their own idempotency key,
their own status vocabulary, their own lease, and their own race between a planner still in flight
and a customer who declined. ADR 0003 gave the same reason for lifting attempt durability out of the
host: every host rebuilt the same lease and replay logic.

## Decision

DomainKit holds the batch. `Storage.batches` is the durable aggregate and `Provision.batch` is the
lifecycle over it: `create`, `resumePlanning`, `approve`, `apply`, `reject`, `get`, and `list`.

**Items are pointers.** A batch item is `(batchId, attachmentId, position, attemptId, planFailure)`.
The plan, the approval, the receipt, the lease, and the apply failure all stay on the attempt the
item names, so no fact about a domain is stored twice and a batch can never show a customer a plan
that disagrees with the attempt it came from. `planFailure` is the one thing an item owns, because
an item that has no plan has no attempt to carry it.

**One digest, one consent.** A batch's digest is SHA-256 over its items' sorted
`attachmentId:planDigest` pairs, so it moves whenever any domain's plan moves. `approve` takes the
digest the principal read and refuses `BatchStale` unless the batch's current plans still produce
it. It then writes one `Approval` per attempt, bound to that attempt's own plan digest, and the
batch's approval in a single transaction: a batch is never approved without the per-attempt
approvals `apply` takes, and an attempt is never approved for a batch that was not.

**Status is derived, and stored.** `Storage.batchStatusOf` computes
`planning | planned | approved | applying | complete | partial | failed | rejected` from the items'
attempt statuses. Every transition recomputes it inside the transaction that locked the batch row,
so the stored value is a cache of the attempts and the owner-scoped unfinished index never disagrees
with them. `complete` and `rejected` are terminal and leave that index; `partial` and `failed` stay
in it, because they still owe a move.

**The per-attempt lease is the item lock.** `apply` walks the approved items with
`Policy.batchConcurrency` in flight and calls the ordinary attempt apply, which claims a lease. A
second apply of the same batch finds those items `Busy` and skips them rather than writing twice.
The batch adds no lease of its own; an item that fails records its failure on its attempt and the
next apply re-claims it.

**Planning is fenced by the aggregate's state.** A planning pass runs outside any transaction,
because it reads a provider. Landing its result checks the batch's status inside the write's own
transaction, so a pass still in flight when the customer declines lands nothing.

**The aggregate has its own refusal.** `Reason.BatchStale` carries the batch id, its status, and its
current digest. `Reason.Stale` names a plan id and a plan digest, and a batch has neither.

## Consequences

- A host supplies requirements per item, to `create` and again to `resumePlanning`. The batch stores
  pointers, not requirements, so the host owns them across a resume.
- `get` reads one attempt per item. `list` reads none, which is what makes an unfinished-batch
  banner cheap.
- Two batches can name the same attachment. The attempt invariants decide what happens: the second
  batch's plan is a new attempt, and approving a plan that is no longer the item's fails
  `BatchStale`.
- A refusal that leaves an attempt untouched — an expired approval, a stale plan — leaves that item
  where it was and the batch `applying`. The batch reports it; the host re-plans that domain.
- Batches are kind-agnostic in storage. Only provisioning is exercised; `Provision.batch` refuses a
  batch of another kind the way `Provision.get` refuses a cleanup attempt.

## Alternatives considered

- **A host-owned manifest.** What every host was already building, and what the evidence for this
  record is: the same idempotency key, lease, replay, and status recomputation written again per
  product, against invariants only `Storage.attempts` can hold.
- **A thin host table over attempts.** Cheaper to ship and still wrong in the same place: the
  digest-bound approval and the planner fence need the batch's state and the attempts' state in one
  transaction, which a table in another database cannot give.
- **Copying plan, approval, and receipt onto the item.** Faster reads, and two records of one fact
  that drift the first time an attempt moves without the batch.
- **A batch-level apply lease.** Would serialize a batch against itself without making any single
  domain safer; the per-attempt lease is what a provider write actually needs.

## References

- `src/Storage.ts`
- `src/Provision.ts`
- `src/internal/attempts.ts`
- `tests/tracer/batch.test.ts`
- [0003: Additive digest-bound plans](0003-additive-digest-bound-plans.md)
- [0008: Optional CapsuleDB persistence](0008-optional-capsuledb-persistence.md)
