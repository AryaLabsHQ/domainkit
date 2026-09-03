## @domainkit/capsuledb@0.9.0

### DomainKit Storage on PostgreSQL as one declarative capsule

`PgStorage.layer()` provides `Storage.Service` over the host's `SqlClient` from one CapsuleDB
capsule with six tables, no host foreign keys, readiness keyed by domain, advisory-lock
`withLock`, `FOR UPDATE` attempt transitions including reject, and two-phase revocation guarded by
credential ciphertext. `mode: "prepare"` migrates at boot; `mode: "assert"` expects the SQL that
`capsuledb emit` writes. Depends on the published `capsuledb` 0.2 and stores rows in the core
schema's encoded form, so the row layout follows `Storage.ts`.

Breaking: `persistence.ts`, host bindings, and package-level custody are gone; credentials arrive
sealed by the core `Custody` service.

## @domainkit/capsuledb@0.1.0

### Add CapsuleDB persistence

Add optional PostgreSQL CapsuleDB persistence for the complete managed-DNS authorization lifecycle.
Hosts retain ownership of the exact SQL client, credential encryption, identity, tenancy, policy,
routes, audit, and consent.
