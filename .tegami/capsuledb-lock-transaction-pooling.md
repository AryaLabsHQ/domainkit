---
packages:
  "@domainkit/capsuledb":
    type: patch
---

## Hold the single-flight guard through a transaction-mode pooler

`PgStorage.withLock` takes a transaction-scoped advisory lock and runs the guarded effect inside that
transaction. A session lock did not survive a pooler in transaction mode, such as PlanetScale's
PgBouncer port: the lock and its unlock could reach different server sessions, so the lock outlived
the guard, later refreshes of that credential failed `Busy`, and a second caller could run a refresh
while the first still held the key. The transaction pins one session, and the lock ends with it on
commit, on rollback, or when a dropped client closes it. The guarded effect's writes now commit
when it succeeds and roll back when it fails, and the transaction stays open across a credential
refresh's provider call.

Inside an open transaction, each `PgStorage` call runs in its own savepoint, so a caller that
recovers from a failed storage call keeps the writes it made before it.
