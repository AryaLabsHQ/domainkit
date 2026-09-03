# 0010: Credential-scoped provider sessions

## Status

Accepted

## Context

One provider credential can reach several accounts and several authoritative zones. A DNS client
that infers a zone from a domain cannot safely choose between them, and a portable contract must
not grow a provider-account inventory model to break the tie.

Providers also differ in ways a generic DNS interface should not absorb. A Cloudflare zone is
addressed by a zone id inside an account; a Vercel domain is addressed by a name inside a team, and
a marketplace installation carries its own identity through the callback.

## Decision

A provider definition exposes a credential-scoped `Session` with four operations and nothing else:

- `listTargets()` returns every zone the credential reaches, each carrying the provider context that
  addresses it, a display label, and the zone's nameservers when the provider reports them;
- `resolveTarget(domain)` answers `Resolved`, `SelectionRequired`, or `NotFound`, and never chooses
  across accounts on the caller's behalf;
- `dns(target)` returns the four record operations bound to one selected target;
- `capabilities()` reports what the credential actually holds.

`Provider.resolveAmong` implements the shared rule so adapters do not restate it: the most specific
zone wins, several matches at the same depth need a selection, none is `NotFound`.

Provider-specific identity lives in the definition's `context` schema and is persisted as an
envelope tagged with `contextVersion`. The generic DNS interface gains no account, inventory,
refresh, or revoke operation; credential lifecycle stays with the auth method that issued it.

`Provider.fromAsync` adapts a Promise-shaped definition at the edge, so an adapter built on an
existing client implements the same seam.

## Consequences

- One credential safely backs targets in more than one provider account.
- A host persists only the selected target on an attachment; no zone or account inventory table is
  needed.
- A provider can refuse an unsupported zone type or account context before any record operation
  runs.
- Adding a provider is adding one value; nothing in the lifecycle changes.

## Alternatives considered

- Resolving a zone implicitly inside the DNS client silently picks an account when a credential
  reaches several.
- A shared account-inventory model puts provider bookkeeping into the portable contract and into
  every host's database.
- Folding refresh and revoke into the DNS interface makes every adapter implement operations most
  providers express differently or not at all.

## References

- `src/Provider.ts`
- `src/Cloudflare.ts`
- `src/Vercel.ts`
- `src/internal/conformance/provider.ts`
