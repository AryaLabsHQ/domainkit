# Credential-scoped provider sessions

## Context

One provider credential can expose several accounts and authoritative zones. A DNS record client
that discovers a zone implicitly from a domain cannot safely choose between those accounts, and a
durable DomainKit connection must not grow a provider-account inventory model just to resolve that
ambiguity.

Vercel integrations also have provider-specific installation semantics: an installation can target
a personal account or team, and the callback's configuration ID is part of the installation
identity. Those semantics do not map to generic OAuth refresh or revocation behavior.

## Decision

Provider adapters expose a credential-scoped session seam with three operations:

1. `listTargets` discovers display-safe account and authoritative-zone targets visible to the
   credential;
2. `resolveTarget` returns `Resolved`, `SelectionRequired`, or `NotFound` without choosing across
   accounts; and
3. `forTarget` returns the focused low-level DNS capability bound to one selected target.

Cloudflare sessions preserve account, zone type, status, and nameserver evidence. Vercel sessions
preserve personal/team context and installation identity during integration authentication, while
target discovery remains scoped to the selected installation. Provider authentication modules own
restoration and their provider-specific credential lifecycle; the generic DNS interface does not
gain refresh, revoke, account, or inventory operations.

Both the Effect-native and Promise entry points expose the same target/session behavior. Target
selection is explicit and remains separate from React or other user-interface concerns.

## Consequences

- A credential may safely back targets in multiple provider accounts and organization connections.
- Hosts persist only the selected `ProviderTarget` on a domain attachment; no provider account or
  zone inventory table is required.
- A provider can reject unsupported zone types or account contexts before record operations begin.
- Existing provider clients remain low-level DNS capabilities while gaining explicit discovery and
  target binding methods.
