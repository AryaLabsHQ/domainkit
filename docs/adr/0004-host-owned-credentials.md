# 0004: Host-owned credentials

## Status

Accepted

## Context

DNS credentials grant externally visible authority, but a portable SDK cannot choose an
application's database, encryption keys, routes, tenant model, audit policy, or consent interface.
Embedding any of those choices in DomainKit would couple the protocol to one hosting model.

## Decision

DomainKit defines OAuth, token, credential-store, continuation-store, and connection-grant
contracts. OAuth protocol mechanics use `oauth4webapi`. Hosts provide secure persistence, transport,
callback routes, authorization UI, and operational policy.

Connection grants remain explicit and are enforced by DomainKit in addition to provider scopes.
The core package contains deterministic in-memory implementations for testing, not a production
credential database or encryption system.

## Consequences

- Hosts can integrate DomainKit with their existing security and tenancy model.
- The core package never needs plaintext credential persistence.
- Hosts are responsible for encryption, access control, rotation, audit logging, and consent UX.
- DomainKit can test lifecycle semantics without claiming to supply production secret storage.

## Alternatives considered

- A library-owned credential database was rejected because storage, migration, encryption, and
  tenant boundaries belong to the host.
- An integration-runtime-owned provider model was rejected because it would make that runtime the
  source of DomainKit's public provider interfaces.

## References

- `src/auth/connection.ts`
- `src/auth/oauth.ts`
- `src/auth/token.ts`
- `src/stores/`
- `src/testing.ts`
