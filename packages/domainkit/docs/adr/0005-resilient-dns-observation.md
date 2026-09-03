# 0005: Resilient DNS observation

## Status

Accepted

## Context

Public recursive resolvers can disagree because of propagation delay, negative caching, outages,
or provider behavior. An authoritative provider read and a public DNS answer are also different
evidence. Flattening either distinction into one Boolean makes failures hard to diagnose and can
make one resolver an accidental availability dependency.

## Decision

`Verify.observe` is the only public observation operation. It reads the provider through the
attachment's session and the public pool through `Resolver`, whose default layer fans out to
Cloudflare and Google RFC wire-format DNS-over-HTTPS. `Resolver.resolve` never fails: every
answer, negative answer, failure, and timeout is a per-resolver outcome. A wire response counts
only when its message id is zero, its single question matches the query in name, class, and type,
it is not truncated, and every answer carries a TTL; a host may pass its own `AbortSignal`.

Readiness is recorded per requirement with its evidence (`ProviderEvidence`, one
`PublicDnsEvidence` per resolver, and `HostEvidence` the host attaches). A requirement is
`satisfied` by an exact match, `mismatch` when an exclusive record meets a conflicting same-set
record, `missing` otherwise, and `unknown` when no source answered. A mismatch at any resolver
outranks agreement elsewhere; `Verify.Policy.quorum` (`any` by default, `all`, or a minimum) sets
how many resolvers must agree for `satisfied`. Provider and public evidence must both be satisfied
for the requirement to be satisfied.

Readiness is persisted per domain, with the attachment linked when one exists, so a host that
only watches public DNS for a domain it never attached gets the same row, ladder, and
`nextCheckAt`. When the attachment's provider session cannot be built, public DNS stands alone
and no provider evidence is recorded. Readiness carries `nextCheckAt` from the `Verify.Policy.backoff` ladder
(15s, 1m, 5m, 30m by default); the pending streak restarts when the requirement set changes and
clears when the attachment is ready. Requirements default to the latest provisioning receipt; an
explicit set is also accepted and an empty set is rejected.

## Consequences

- One negative cache does not hide a matching independent resolver under the default policy.
- Hosts replace the resolver pool without replacing verification decisions.
- Provider readback is never mistaken for public propagation.
- Hosts keep their own state machine and webhooks and merge provider-side evidence such as an
  email identity status through `attachEvidence`.
- The JSON DoH presentation format is not part of DomainKit's critical path.

## Alternatives considered

- Separate public and provider operations force callers to combine two results.
- A single default resolver is an avoidable availability dependency.
- JSON DoH has no formal RFC and varies between providers.

## References

- `src/Resolver.ts`
- `src/internal/doh.ts`
- `src/Verify.ts`
- `tests/verify/observe.test.ts`
