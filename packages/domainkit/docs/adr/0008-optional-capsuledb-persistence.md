# 0008: Optional CapsuleDB persistence

## Status

Accepted

## Context

ADR 0004 assigned durable persistence to each host because DomainKit could not choose an
application's database, keys, tenant model, routes, or policy. That boundary also forced every SQL
host to reimplement the same authorization aggregate, concurrency, and resumable-revocation
semantics. Samva now provides a production-shaped PostgreSQL tracer and already owns the exact
tenant/domain foreign keys and encrypted credential ciphertext that must survive adoption.

## Decision

DomainKit supplies an independent optional `@domainkit/capsuledb` package. It owns the PostgreSQL
schema and typed implementation for the complete `ManagedDnsConnections.Service`, while the host
constructs the CapsuleDB registry, supplies one `SqlClient`, calls `Registry.prepare` once during
startup, and provides the capsule layer to API and workflow entrypoints.

The package requires two semantic host capabilities:

- `CredentialCustody` seals and opens credentials. Keys, KMS configuration, plaintext lifetime,
  rotation policy, and audit remain host-owned.
- `HostBindings` maps semantic owner/domain values to opaque host foreign-key references at
  operation time. It is stateless and joins the active SQL transaction; the capsule never captures
  one request's tenant identity.

The PostgreSQL tracer adopts `domain_provider_authorizations`,
`organization_domain_provider_connections`, and `domain_provider_attachments` in place. Existing
ciphertext and host foreign keys are preserved. Portable domain and target semantics are decoded
from existing columns and versioned JSON. One final host migration may backfill that projection
before CapsuleDB becomes the single migration owner. There is no indefinite dual write or parallel
copy.

Provider revocation and credential custody calls never run inside a database transaction. The
repository durably prepares final revocation, releases the transaction, calls the provider, and
then atomically completes deletion; failure leaves resumable pending state. PostgreSQL row locks and
advisory locking serialize aggregate mutation, while reads lock the aggregate root for atomic
visibility.

## Consequences

- The `domainkit` root stays lightweight and has no CapsuleDB dependency.
- Hosts may continue implementing `ManagedDnsConnections.Service` themselves.
- CapsuleDB and Effect Drizzle can share the exact host `PgClient` and transaction context.
- PostgreSQL is the only supported provider in the first tracer. Bun SQLite, libSQL, and D1 are
  deferred.
- Package release cadence is independent from the synchronized `domainkit` and `@domainkit/react`
  group.
- A host must converge legacy rows before readiness; incompatible ciphertext or attachment context
  fails closed.

## Alternatives considered

- Adding CapsuleDB to the root package was rejected because every consumer would pay the dependency
  and release coupling.
- A Samva-owned capsule was rejected because it would make the durable lifecycle non-portable and
  keep DomainKit semantics duplicated in the host.
- A new namespaced attachment table was rejected because Samva already has authoritative rows and
  foreign keys; a second table would create competing state.
- A portable SQL DSL or Drizzle adapter was rejected. The capsule owns explicit PostgreSQL SQL and
  exposes only the semantic Effect service.

## References

- `src/auth/lifecycle-repository.ts`
- `packages/capsuledb/src/persistence.ts`
- `packages/capsuledb/src/custody.ts`
- `packages/capsuledb/src/host-bindings.ts`
- `docs/adr/0004-host-owned-credentials.md`
