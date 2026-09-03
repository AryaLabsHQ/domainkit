# 0009: Authorization, connection, attachment

## Status

Accepted

## Context

A customer's provider access answers three different questions: what credential exists and how it is
kept alive, which of the customer's organizations may use it, and which exact zone a given domain
writes into. Collapsing them into one row makes a provider account look like the durable identity,
forces the host to coordinate account deduplication and revocation across stores, and leaves no
place to record the zone a domain was actually bound to.

## Decision

`Storage` holds three rows, and each answers one question.

An **authorization** owns the credential lifecycle: the sealed secret, the provider account context
as a versioned envelope, the capabilities the session reported, and the revocation state. Its
credential material and revocation bookkeeping never leave `Connect`.

A **connection** is the principal-facing handle over one authorization. It is what a host names in
its own UI and what `Connect.disconnect` takes. One authorization can back several connections and
one connection can serve several domains.

An **attachment** binds one domain to one connection and one exact `Provider.Target`: the zone, its
label, and the provider identity that addresses it. A domain has at most one attachment per owner.

DomainKit never deduplicates by provider account. A second organization connecting the same account
supplies its own fresh proof and gets its own authorization, so no organization inherits another's
access.

Reuse is explicit. `Connect.discover` answers which of a principal's existing connections already
reaches a domain, from the domain's authoritative nameservers and each connection's zone list, and
`Connect.attach` binds it. `Connect.Policy.allowReuse` decides whether an owner's connection may
serve a given domain.

Every session handed to `Provision`, `Cleanup`, or `Verify` is re-checked against the provider: the
attached zone must still be among the targets the credential reaches, else `NotFound`.

A connection cannot be removed while attachments still reference it, and `Connect.disconnect`
detaches every domain and then revokes the credential where the method supports it. Revocation is
two-phase, so a failure between marking and deleting leaves a row recovery finishes later.

## Consequences

- A host names connections and attachments in its own UI without modelling provider accounts.
- The second domain on a connected provider costs a discovery call and an attach, not another
  consent screen.
- The provider identity a domain writes into is recorded once, so a credential that later reaches
  more or fewer zones cannot silently retarget an existing domain.
- Detaching a domain leaves its records in DNS; removing them is a separate cleanup plan.

## Alternatives considered

- One row per credential makes the provider account the durable identity and forces the host to
  decide what happens when two organizations authenticate the same account.
- Resolving the zone at write time instead of recording it lets a credential's changing zone list
  move an existing domain's records.
- Implicit reuse by provider account grants one organization access another organization proved.

## References

- `src/Storage.ts`
- `src/Connect.ts`
- `src/Provider.ts`
- `tests/connect/`
