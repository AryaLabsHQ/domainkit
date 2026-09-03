# 0003: Additive digest-bound plans with durable attempts

## Status

Accepted

## Context

DNS changes can disrupt production traffic, and authoritative DNS APIs do not consistently expose
conditional writes or multi-record transactions. A portable SDK must make customer approval exact,
detect observed drift, report confirmed writes without pretending the provider is transactional,
and survive the plan, consent, and apply steps landing in three separate requests.

## Decision

`Provision.plan` reads the attached zone and builds a `Plan` whose operations are `Create`,
`Noop`, or `Conflict`, with a SHA-256 digest over every operation. The digest ignores requirement
labels (`purpose`), so relabeling never invalidates consent. `Provision.approve` records an
`Approval` bound to that digest and to explicit operation ids; a plan with conflicts is approved
only with `allowPartial` and a conflict-free selection. `Provision.apply` re-plans the zone before
the first write and fails `Stale` when the digest moved, then revalidates every approved create
before writing it.

The planner is additive only: missing records are created, exact records are no-ops, and
incompatible state is a conflict. Requirements declare `exclusive` or `append` policy; CNAME
requirements are always exclusive. DomainKit does not update, overwrite, or delete records it did
not create.

Every step is a stored attempt (`planned -> approved -> applying -> complete | partial | failed`)
held in `Storage` with an apply lease. Approving an approved plan returns the same approval;
applying a completed attempt returns its receipt; a claim while the lease is live fails `Busy`.

Apply is resumable rather than falsely atomic. A failure after a confirmed write produces a
`partial` `Receipt` in the success channel that lists every operation: `Applied` with the
provider record id, `Failed` with the message, `Skipped` for no-ops, unapproved operations, and
operations not reached. A failure before any write marks the attempt `failed` and rethrows; the
next apply re-claims it. DomainKit does not roll records back.

`Cleanup.plan` builds a separate plan from a receipt: each applied record is read back by its
provider record id and becomes `Delete` when it still matches exactly, or `Conflict` when it is
missing or changed. Cleanup has its own approval and receipt under the same attempt rules.

## Consequences

- Approval cannot silently expand to operations the customer did not approve.
- Revalidation narrows the race between the final read and the provider write; it cannot remove
  it.
- Hosts reconcile partial receipts by re-planning; the applied records become no-ops and the rest
  become creates.
- A host can render the plan, collect consent, and apply in three requests and retry any of them.
- `Storage` records no per-write progress, so a crash between writes leaves those records without
  a receipt until the host re-plans.

## Alternatives considered

- Automatic overwrite or deletion can destroy unrelated DNS state.
- Automatic rollback can fail or remove state another actor now depends on.
- Treating a sequence of provider writes as atomic misrepresents the provider contracts.
- Keeping attempt durability in the host meant every host rebuilt the same lease and replay logic.

## References

- `src/Plan.ts`
- `src/Approval.ts`
- `src/Receipt.ts`
- `src/internal/planner.ts`
- `src/internal/attempts.ts`
- `tests/tracer/lifecycle.test.ts`
