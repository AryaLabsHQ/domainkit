# 0007: Effect-native host routes

## Status

Accepted

## Context

Every host needs authenticated provider-connection start and callback routes. Reimplementing the
same routing, callback URL, continuation, replay, and redirect mechanics makes provider adoption
needlessly bespoke. Moving those routes into a hosted control plane would instead take identity,
tenancy, credentials, persistence, and policy away from the application that owns them.

## Decision

`domainkit/server` exports an Effect-native `Server.Handler` Layer. It owns the portable route
mechanics for interactive connection start and callback completion. The host supplies Layers for
identity, provider-flow configuration, short-lived pending authorizations, durable managed-DNS
connections, and cryptography.

The default mount path is `/api/domainkit`; a host may configure it. The public base URL may be
configured and otherwise comes from the start request origin. Return destinations are validated
against that origin before persistence. Callback state is consumed exactly once before a durable
connection is committed.

`Server.toWebHandler` adapts a fully provided Layer to the standard Web `Request` and `Response`
contract. It is a secondary host-framework boundary, not an async factory or a second lifecycle.
Sibling dependencies are composed with `Layer.mergeAll` and provided once to the route Layer.

## Consequences

- A host mounts one catch-all route instead of rebuilding provider callback mechanics.
- Credentials, identity, tenancy, persistence, consent, and audit policy remain host-owned.
- Reverse-proxy deployments should set `baseURL` explicitly.
- Short-lived callback state and durable provider authorization stay separate capabilities.
- Framework adapters share the same Effect implementation and failure model.

## Alternatives Considered

- A hosted DomainKit callback service was rejected because it would create a control plane and
  credential boundary DomainKit does not own.
- An async factory as the canonical API was rejected because it hides Layer requirements and
  duplicates Effect runtime ownership.
- Requiring every host to author the routes was rejected because callback safety and replay
  behavior should not drift between consumers.

## References

- `src/server.ts`
- `src/server/index.ts`
- `tests/server/routes.test.ts`
- `tests/artifact/packed-consumers.test.ts`
