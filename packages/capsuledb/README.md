# `@domainkit/capsuledb`

Optional PostgreSQL persistence for DomainKit's Effect-first managed-DNS authorization lifecycle.

The host owns and supplies the exact `SqlClient`, credential encryption, identity and tenant
policy, stable owner/domain bindings, audit, routes, and consent. The package exposes only semantic
Effect services. It does not export tables, rows, queries, an ORM adapter, or a Promise-first API.

This package is the published PostgreSQL persistence implementation for DomainKit. Its development
dependency pins the reviewed CapsuleDB Git SHA; that pin is excluded from the packed runtime
dependency graph.
