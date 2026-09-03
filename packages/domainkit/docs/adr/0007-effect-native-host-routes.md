# 0007: One mounted route group and a capability-gated transport

## Status

Accepted

## Context

Every host that offers custom domains needs the same authenticated routes: inspect a domain,
connect a provider, finish an interactive callback, plan, approve, apply, observe, and clean up.
Hosts that rebuild those routes reimplement callback URLs, continuation state, digest-bound
approval, and the error-to-status table, and each rebuild drifts. Moving the routes into a hosted
service would instead take identity, tenancy, credentials, persistence, and policy away from the
application that owns them.

## Decision

`domainkit/server` publishes `Server.group`, one `HttpApiGroup` covering the whole lifecycle in
fifteen endpoints. A host adds it to its own `HttpApi` and provides `Server.layer(api)` for the
handlers. The group declares no prefix, so `Server.group.prefix("/internal/dns")` or a router mount
moves every route at once and the OAuth callback URL follows the mount. `Server.api` is the same
group as a standalone API, and `OpenApi.fromApi` documents it without extra work.

`Server.Identity` is the only service a host must implement: a request maps to `Principal.Shape` by
verifying a credential the host issued, never by reading a tenant id off the request. Each handler derives the principal for the request it is serving and provides it
to `Connect`, `Provision`, `Cleanup`, and `Verify`, so no route can read across owners. Everything
else comes from `DomainKit.layer` plus `Storage`.

`/callback/:provider` is a top-level navigation the provider sends the browser on, so a host's
`Identity` must recognise a credential the browser attaches by itself; a header-only scheme fails
every interactive connection at completion.

The OAuth callback redirects to the destination stored on the continuation the customer's own
request created, or to `defaultReturnTo`, and only after checking it is a path on this server or a
URL on the callback's origin. The provider's query string never chooses where the customer lands.

Failures cross the wire as the `DomainKit.Error` value itself, with the status `DomainKit.Error`
already derives from its reason: 400 `InvalidInput`, 401 `Unauthenticated`, 403 `Forbidden` and
`Reconnect`, 404 `NotFound`, 409 `Conflict`, `Stale`, `Expired`, `Busy` and `ProviderConflict`,
501 `Unsupported`, 502 `ProviderRejected`, 503 `ProviderUnavailable`, 500 for the internal reasons. Hosts that map their own routes use the
same table.

`Server.toWebHandler(services, { prefix })` is the Promise edge: one `fetch`-shaped handler and a
`dispose`, for hosts that are not on Effect's HTTP stack. Async persistence and custody adapt at
`Storage.layerFromAsync` and `Custody.layerFromAsync`; nothing else in the lifecycle has a Promise
mirror.

`domainkit/client` ships `Transport.fromFetch(baseUrl)` over those routes. A transport declares
capability groups (`connection`, `provisioning`, `verification`, `cleanup`) and each group is
optional, so a host that exposes only connection routes gets a transport that typechecks and a UI
that renders only what the server can serve.

## Consequences

- A host mounts one group and writes one `Identity` layer instead of rebuilding provider callback
  mechanics.
- Credentials, identity, tenancy, persistence, consent, and audit policy stay host-owned.
- The same wire schemas type the server, the fetch transport, and `@domainkit/react`, so the three
  cannot drift.
- Mounting under a different base path is a prefix, never request re-hosting.
- A provider cannot turn the callback into an open redirect.
- Reverse-proxy deployments that cannot see their public origin set `callbackBaseUrl`.
- Hono, Next.js App Router, and TanStack Start mount the same Web handler.

## Alternatives considered

- A hosted DomainKit callback service creates a control plane and credential boundary DomainKit
  does not own.
- Per-framework route adapters multiply the surface that a prefix already solves.
- A transport with every method required forces hosts to expose routes they do not want and leaves
  the UI unable to know what is missing.
- One error status for every failure loses the retry and reconnect signal the reason already
  carries.

## References

- `src/Server.ts`
- `src/Transport.ts`
- `src/Reason.ts`
- `tests/server/httpapi.test.ts`
- `tests/client/transport.test.ts`
