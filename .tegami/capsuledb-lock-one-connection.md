---
packages:
  "@domainkit/capsuledb":
    type: patch
---

## Refresh credentials on a one-connection pool

`PgStorage` runs the storage calls a single-flight guard protects, such as the credential reads and
the transactional rotate in a credential refresh, on the connection that holds the guard's advisory
lock. A host whose SQL pool holds one connection, such as a Lambda, refreshes an expired OAuth
credential instead of waiting for a second connection. The lock stays a session lock, so no
transaction is open across the provider call.
