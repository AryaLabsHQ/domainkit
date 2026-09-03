# 0004: Host-owned identity, library-owned credential lifecycle

## Status

Accepted

## Context

DNS credentials grant externally visible authority, but a portable SDK cannot choose an
application's database, routes, tenant model, audit policy, or consent interface. It can own the
credential lifecycle itself: sealing, refresh, revocation, and the tenancy check on every read.

## Decision

The host provides three seams. `Principal` (`ownerId`, `actorId`) is a required per-request
service with no default; every `Storage` method and lifecycle operation requires it, so
cross-tenant access is a type error. `Storage` persists authorizations, connections, attachments,
continuations, attempts, and readiness scoped by that principal. `Custody` seals credentials;
the core ships AES-256-GCM over Web Crypto from one configured key, and a host with a KMS provides
its own implementation.

`Storage` never sees plaintext: `Connect` seals a credential through `Custody` before writing it
and opens it after reading it. `Connect` also owns the connection lifecycle: token and interactive
(OAuth, integration) methods, continuations stored in `Storage` and spent only after the connection
is persisted, refresh before expiry single-flighted through `Storage.withLock`, and two-phase
revocation on disconnect that leaves a pending row for recovery when the provider call fails.

Access-token expiry is credential metadata, not authorization expiry. A credential with a refresh
token stays refreshable after its access token expires; a credential the provider will no longer
refresh surfaces as `Reconnect` and the host presents reconnect UX. Capabilities the session
reports are recorded on the authorization and enforced by DomainKit in addition to provider
scopes.

## Consequences

- Hosts integrate DomainKit with their existing security and tenancy model while writing no
  refresh, sealing, or revocation logic.
- The core never chooses plaintext persistence; a Storage implementation stores ciphertext only.
- Hosts own keys, KMS configuration, rotation policy, audit logging, and consent UX.
- Interactive flows tolerate a failed provider or storage call before persistence; a provider code
  the provider already redeemed needs a fresh start.
- `Testing.conformance.storage` checks tenant isolation, exactly-once continuations, leases,
  revocation recovery, and lock semantics for any Storage implementation.

## Alternatives considered

- A library-owned database client or credential vault couples the protocol to one hosting model.
- Sealing inside each Storage implementation duplicates encryption per backend and leaves async
  host adapters without it.
- An unenforced `ownerId` string forces hosts to mirror tables to verify tenancy.

## References

- `src/Principal.ts`
- `src/Storage.ts`
- `src/Custody.ts`
- `src/Connect.ts`
- `src/internal/conformance/storage.ts`
