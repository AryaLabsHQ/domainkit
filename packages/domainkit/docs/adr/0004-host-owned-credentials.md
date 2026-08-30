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
Hosts provide secure persistence, transport, callback routes, authorization UI, and operational
policy.

The repository owns one logical commit for the authorization aggregate, credential, and owner
bindings. SQL hosts may transact it; hosts that split database and vault storage implement an
idempotent recoverable saga behind the same seam. Interactive continuations are short-lived and
one-time, but Redis or another cache is never authoritative for the durable authorization.

Connection grants remain explicit and are enforced by DomainKit in addition to provider scopes.
Capability evidence records whether access was declared, introspected, or exercised. Final-binding
revocation retains durable retry state until the provider confirms revocation. The package contains
deterministic in-memory implementations for testing, not a production credential database or
encryption system.

## Consequences

- Hosts can integrate DomainKit with their existing security and tenancy model.
- The core package never chooses plaintext credential persistence or a cache as durable truth.
- Hosts are responsible for encryption, access control, rotation, audit logging, and consent UX.
- DomainKit can test lifecycle semantics without claiming to supply production secret storage.

## Alternatives considered

- A library-owned credential database was rejected because storage, migration, encryption, and
  tenant boundaries belong to the host.
- An integration-runtime-owned provider model was rejected because it would make that runtime the
  source of DomainKit's public provider interfaces.

## References

- `src/auth/connection.ts`
- `src/auth/connect.ts`
- `src/auth/lifecycle-repository.ts`
- `src/auth/connection.ts`
- `src/testing.ts`
