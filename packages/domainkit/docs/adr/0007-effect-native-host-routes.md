# 0007: Effect-first host routes with an async boundary

## Status

Accepted

## Context

Every host needs authenticated provider-connection start and callback routes. Reimplementing the
same routing, callback URL, continuation, replay, and redirect mechanics makes provider adoption
needlessly bespoke. Moving those routes into a hosted control plane would instead take identity,
tenancy, credentials, persistence, and policy away from the application that owns them.

## Decision

`domainkit/server` keeps one Effect-native route program for interactive connection start and
callback completion. `Server.make` exposes the constructor and `Server.layer` exposes the handler
as a Layer. The host supplies identity, authorization-reuse policy, provider-flow configuration,
short-lived pending authorizations, durable managed-DNS connections, and cryptography.

The default mount path is `/api/domainkit`; a host may configure it. The public base URL may be
configured and otherwise comes from the start request origin. Return destinations are validated
against that origin before persistence. Callback state is consumed exactly once before a durable
connection is committed.

`Server.toWebHandler` adapts a fully provided Layer to the standard Web `Request` and `Response`
contract. For non-Effect applications, the named `createDomainKit` export accepts Promise-based
host capabilities and returns the same Web handler. It adapts those capabilities into the canonical
Effect program instead of defining a second lifecycle.

Async hosts must supply their own durable persistence implementation. DomainKit does not select a
database, initialize schemas, run migrations, or own the persistence client's disposal.
`@domainkit/capsuledb` remains Effect-native; adding an async CapsuleDB lifecycle is a separate
future decision.

## Consequences

- A host mounts one catch-all route instead of rebuilding provider callback mechanics.
- Credentials, identity, tenancy, persistence, consent, and audit policy remain host-owned.
- Reverse-proxy deployments should set `baseURL` explicitly.
- Short-lived callback state and durable provider authorization stay separate capabilities.
- Framework adapters share the same Effect implementation and failure model.
- Hono, Next.js App Router, and TanStack Start can mount the same Web handler.
- Effect hosts retain Layer composition and scoped lifecycle semantics.
- Async hosts receive a smaller integration surface but own persistence lifecycle explicitly.

## Alternatives Considered

- A hosted DomainKit callback service was rejected because it would create a control plane and
  credential boundary DomainKit does not own.
- Making the async factory canonical was rejected because it would hide Layer requirements from
  Effect-native hosts.
- Bundling async persistence or CapsuleDB lifecycle into the factory was rejected because database
  ownership and readiness belong to the host.
- Requiring every host to author the routes was rejected because callback safety and replay
  behavior should not drift between consumers.

## References

- `src/server.ts`
- `src/server/index.ts`
- `tests/server/routes.test.ts`
- `tests/artifact/packed-consumers.test.ts`
