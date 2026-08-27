# 0003: Additive digest-bound plans

## Status

Accepted

## Context

DNS changes can disrupt production traffic, and authoritative DNS APIs do not consistently expose
conditional writes or multi-record transactions. A portable SDK must make user authorization exact,
detect observed drift, and report confirmed writes without pretending the provider is transactional.

## Decision

Versioned JSON plans contain canonical operations and a deterministic SHA-256 digest. Authorization
binds that digest to explicit operation identifiers. Apply rejects altered or unapproved operations,
checks for observed drift before the first write, and revalidates every approved create.

The portable planner is additive-only: missing records may be created, exact records are no-ops, and
incompatible state is a conflict. Requirements explicitly declare `exclusive` or `append` policy;
CNAME requirements are always exclusive. DomainKit does not automatically update, overwrite, or
delete DNS records.

Apply is resumable rather than falsely atomic. If a later operation fails after an approved create
succeeds, `PartialApplyError` carries a versioned receipt containing every known successful provider
record identifier. DomainKit does not roll those records back automatically.

## Consequences

- Authorization cannot silently expand to operations the user did not approve.
- Revalidation narrows but cannot eliminate the race between the final read and provider write.
- Hosts must reconcile partial receipts and choose any destructive remediation explicitly.
- Coexistence is opt-in and visible in each requirement.

## Alternatives considered

- Automatic overwrite or deletion was rejected because it can destroy unrelated DNS state.
- Automatic rollback was rejected because rollback can fail or remove state another actor now
  depends on.
- Treating a sequence of provider writes as atomic was rejected because the provider contracts do
  not support that guarantee.

## References

- `src/plan/types.ts`
- `src/plan/plan.ts`
- `src/domain/dns-record.ts`
- `tests/tracer/plan-apply.test.ts`
