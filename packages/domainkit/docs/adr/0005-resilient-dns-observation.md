# 0005: Resilient DNS observation

## Status

Accepted

## Context

Public recursive resolvers can disagree because of propagation delay, negative caching, outages,
or provider behavior. An authoritative provider read and a public DNS answer are also different
evidence. Flattening either distinction into one Boolean makes failures hard to diagnose and can
make one resolver an accidental availability dependency.

## Decision

`Verification.observe(config)` is the only public observation operation. Public DNS is enabled by
default through named Cloudflare and Google RFC wire-format DNS-over-HTTPS resolvers with
`AnyMatch`. `AllMatch` and `Quorum` are explicit tagged policy values. Every answer, no-data result,
timeout, and failure remains in the returned evidence.

Provider observation is an explicit tagged opt-in and requires an authoritative zone and provider
capability. If public and provider sources are both requested, both must match for the aggregate to
be `Verified`. Results are exhaustive tagged values: `NotObserved`, `Pending`, `Mismatch`,
`Unavailable`, or `Verified`.

## Consequences

- One negative cache does not hide a matching independent resolver under the default policy.
- Hosts can replace the resolver pool without replacing verification decisions.
- Provider readback is never mistaken for public propagation.
- The JSON DoH presentation format is not part of DomainKit's critical path.

## Alternatives considered

- Separate public and provider operations were rejected because callers need one explicit source
  configuration and one exhaustive aggregate.
- A single default resolver was rejected as an avoidable availability dependency.
- JSON DoH was rejected because it has no formal RFC and can vary between providers.

## References

- `src/verification/resolver-pool.ts`
- `src/verification/doh.ts`
- `src/verification/verify.ts`
- `tests/verification/observe.test.ts`
