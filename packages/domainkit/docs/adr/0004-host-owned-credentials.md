# 0004: Host-owned credentials

## Status

Accepted

## Context

DNS credentials grant externally visible authority, but a portable SDK cannot choose an
application's database, encryption keys, routes, tenant model, audit policy, or consent interface.
Embedding any of those choices in DomainKit would couple the protocol to one hosting model.

## Decision

DomainKit defines token and interactive connection methods, a continuation store, connection
grants, and one authorization-lifecycle repository. OAuth protocol mechanics use `oauth4webapi`.
Hosts provide secure persistence, transport, authenticated route mounting, authorization UI, and
operational policy. ADR 0007 permits DomainKit to supply the portable handler mechanics behind
those host-owned routes without choosing identity, tenancy, or deployment.

ADR 0008 narrows the persistence portion of this decision: an optional DomainKit-owned CapsuleDB
package may supply the durable schema and lifecycle implementation. The host still owns and
supplies the database client and connection lifetime, credential encryption and keys, tenant/domain
bindings, identity, authorization, audit, routes, and consent.

The repository owns one logical commit for the authorization aggregate, credential, and owner
bindings. SQL hosts may transact it; hosts that split database and vault storage implement an
idempotent recoverable saga behind the same seam. Interactive continuations are short-lived and
one-time, but Redis or another cache is never authoritative for the durable authorization.

Access-token expiry is credential metadata rather than provider-authorization expiry. A credential
whose access token has expired remains refreshable when it retains a refresh token. Provider
adapters may implement the protocol-specific exchange and classify terminal grant failures, while
the host serializes concurrent attempts, persists the complete rotated credential before use, and
decides when to present reconnect UX.

Connection grants remain explicit and are enforced by DomainKit in addition to provider scopes.
Capability evidence records whether access was declared, introspected, or exercised. Final-binding
revocation retains durable retry state until the provider confirms revocation. The package contains
deterministic in-memory implementations for testing, not a production credential database or
encryption system.

## Consequences

- Hosts can integrate DomainKit with their existing security and tenancy model.
- The core package never chooses plaintext credential persistence or a cache as durable truth.
- Hosts are responsible for encryption, access control, rotation, audit logging, and consent UX.
- Provider authorization remains durable across ordinary access-token refreshes.
- DomainKit can test lifecycle semantics without claiming to supply production secret storage.

## Alternatives considered

- A library-owned database client or credential vault remains rejected. ADR 0008 permits a package-
  owned schema over the host's client while keeping encryption and tenant boundaries host-owned.
- An integration-runtime-owned provider model was rejected because it would make that runtime the
  source of DomainKit's public provider interfaces.

## References

- `src/auth/connection.ts`
- `src/auth/connect.ts`
- `src/auth/lifecycle-repository.ts`
- `src/auth/connection.ts`
- `src/testing.ts`
- `docs/adr/0007-effect-native-host-routes.md`
- `docs/adr/0008-optional-capsuledb-persistence.md`
