# 0008: Optional CapsuleDB persistence

## Status

Accepted

## Context

`Storage` is the durable seam every lifecycle operation goes through: authorizations with sealed
credentials, connections, attachments, interactive-flow continuations, attempts carrying a plan,
approval and receipt, and observed readiness. A host implementing that itself has to reproduce
tenant scoping on every query, single-flight credential refresh, attempt leases and replay, and
resumable revocation. Those are protocol invariants, not application choices, and a conformance
suite is a poor substitute for shipping one implementation that holds them.

## Decision

DomainKit ships one optional package, `@domainkit/capsuledb`, that implements `Storage.Storage` on
PostgreSQL through a declarative CapsuleDB capsule. The `domainkit` root has no dependency on it;
a host that persists elsewhere provides its own `Storage`, in Effect or through the async adapter.

The capsule declares six tables under a `domainkit` prefix — authorizations, connections,
attachments, continuations, attempts, readiness — and one additive migration. Every table carries
`owner_id`, and every query filters by the `Principal`, so a row belonging to another tenant reads
as absent rather than forbidden. The package declares no foreign keys, to host tables or between its
own; a host adds the ones it wants in the SQL it applies.

`PgStorage.layer()` composes the capsule through CapsuleDB's registry: create the ledger, apply
pending migrations, then provide `Storage`. It requires only the host's `SqlClient`, because
credentials are sealed through `Custody` before they reach a row and Storage never handles
plaintext. A host that owns its migration pipeline runs `capsuledb emit`, applies the SQL itself,
and boots with `mode: "assert"`, which touches no schema and fails unless the database already
matches the capsule.

Concurrency is the database's, not the process's. Aggregate transitions run in one transaction over
a `FOR UPDATE` row; duplicates are decided by unique constraints through `ON CONFLICT ... DO
NOTHING`; a continuation is claimed by `DELETE ... RETURNING`, which is what makes it exactly once.
Provider revocation and custody calls never run inside a transaction: the row is durably marked
`pending`, the transaction closes, the provider is called, and a second transaction deletes the row.
A failure between the two leaves recoverable state. The single-flight guard is a session advisory
lock held on a reserved connection, so a credential refresh can call the provider without holding a
transaction open.

PostgreSQL is the only engine shipped. The `Storage` contract and its conformance suite are
engine-neutral, and further engines are layers in the same package.

## Consequences

- The host owns its `SqlClient` and its lifetime. The package never opens, replaces, or closes it.
- The table prefix is part of the physical layout and is fixed at the first deploy; changing it
  changes the rendered DDL and the migration checksum.
- A host that wants foreign keys, partitioning, or row-level security adds them to the emitted SQL
  and boots in assert mode.
- Both implementations of `Storage` — this one and the in-memory one in `domainkit/testing` — are
  held to `Testing.conformance.storage`, so a host can swap them without changing behavior.
