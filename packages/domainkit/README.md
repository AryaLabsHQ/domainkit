# DomainKit

Add custom domains to a TypeScript SaaS application.

DomainKit turns DNS requirements into plans a customer can review, applies only the plan digest
they approved, keeps a receipt of every write, and plans cleanup from that receipt. Cloudflare and
Vercel are built in; a provider is one declarative value, so tokens-only providers are the same
shape minus the OAuth case.

## Install

```sh
npm install domainkit effect@rc
```

Node.js 24.10 or newer and Effect 4 are required.

## Plan, approve, apply

```ts
import { Effect, Match } from "effect";
import { DnsRecord, DomainKit, Principal, Provision, Verify } from "domainkit";
import { Testing } from "domainkit/testing";

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];

const program = Effect.gen(function* () {
  const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
  //    ^ operations: [Create CNAME, Noop TXT] with a digest the customer approves

  const approval = yield* Provision.approve(plan);
  const receipt = yield* Provision.apply(approval);
  //    ^ status: "complete" | "partial", one outcome per operation, safe to retry

  const readiness = yield* Verify.observe({ domain: "app.example.com" });
  return { receipt, ready: readiness.overall === "ready", nextCheckAt: readiness.nextCheckAt };
}).pipe(
  Effect.catchTag("DomainKitError", (error) =>
    Match.value(error.reason).pipe(
      Match.tag("Conflict", ({ operations }) =>
        Effect.fail(`Fix ${operations.length} conflicting record(s) first`),
      ),
      Match.tag("Stale", () => Effect.fail("Provider changed under us; plan again")),
      Match.orElse(() => Effect.fail(error.message)),
    ),
  ),
);

export const main = program.pipe(
  Effect.provideService(Principal.Service, { ownerId: "org_42", actorId: "user_7" }),
  Effect.provide(
    DomainKit.layerMemory({ providers: [Testing.provider({ zones: ["example.com"] })] }),
  ),
);
```

Plans are additive and fail closed: exact records are `Noop`, missing records are `Create`, and
incompatible state is `Conflict`. DomainKit never updates or deletes a record it did not create,
and cleanup is its own plan, approval, and receipt built from the apply receipt.

Every step is a stored attempt, so a host can render the plan in one request, collect consent in
another, and apply in a third; retrying any step replays its result. A customer who declines calls
`Provision.reject`, which closes the attempt for good and leaves the domain free for a new plan. Every failure is one
`DomainKit.Error` whose `reason` you match on; `category`, `isRetryable`, and `httpStatus` derive
from it.

## Wire it into your app

```ts
import { Config, Layer } from "effect";
import { Cloudflare, Custody, DomainKit, Vercel } from "domainkit";

export const DomainKitLive = DomainKit.layer({
  providers: [
    Cloudflare.provider({
      oauth: {
        clientId: Config.string("CF_CLIENT_ID"),
        clientSecret: Config.redacted("CF_CLIENT_SECRET"),
      },
    }),
    Vercel.provider(), // tokens only
  ],
}).pipe(
  // `provideMerge`, not `provide`: `domainkit/server`'s handlers read attempts and receipts
  // straight from Storage, so the layer they are given has to still carry it.
  Layer.provideMerge(Layer.mergeAll(YourStorage, Custody.layerConfig())),
);
```

The host provides two services beneath the layer and one per request:

- `Storage` — every durable row (authorizations with sealed credentials, connections, attachments,
  continuations, attempts, readiness). `Storage.layerMemory` is for tests; the Postgres
  implementation lives in `@domainkit/capsuledb`; `Storage.layerFromAsync` wraps a Promise-shaped
  implementation of your own. `Testing.conformance.storage` checks any implementation.
- `Custody` — seals credentials before Storage sees them. `Custody.layerConfig()` reads a 32-byte
  key from `DOMAINKIT_CUSTODY_KEY`; `Custody.layerFromAsync` wraps a KMS.
- `Principal` — `{ ownerId, actorId }` per request. Every Storage read and write is scoped by it, so
  cross-tenant access is a type error, not a runtime check.

`Connect.start` connects a provider (a token in one call, OAuth or a marketplace integration via a
redirect and `Connect.complete`), attaches domains, refreshes credentials before they expire, and
revokes them on disconnect. `Verify.observe` reads the provider and public DNS, stores readiness
per requirement, and tells you when to look again; pass `requirements` to observe records a
customer applies by hand on a domain with no attachment.

## Mount the routes

```ts
import { Effect, Layer } from "effect";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { DomainKit, Reason } from "domainkit";
import { Server } from "domainkit/server";

// Verify a credential you issued and look the tenant up yourself. A request never names its own
// `ownerId`, and one you cannot attribute fails closed. Read it from a cookie: `/callback/:provider`
// is a browser navigation, so only what the browser sends by itself arrives with it.
const IdentityLive = Layer.succeed(Server.Identity)({
  principal: (request) =>
    Effect.flatMap(yourSessions.verify(request.cookies.session), (session) =>
      session === null
        ? Effect.fail(
            new DomainKit.Error({ reason: new Reason.Unauthenticated({ message: "No session" }) }),
          )
        : Effect.succeed({ ownerId: session.orgId, actorId: session.userId }),
    ),
  // Optional: which routes this principal may reach. Members read, administrators write.
  authorize: (principal, endpoint) =>
    principal.actorId === "admin" || !writeRoutes.has(endpoint)
      ? Effect.void
      : Effect.fail(
          new DomainKit.Error({
            reason: new Reason.Forbidden({ message: `${endpoint} needs an administrator` }),
          }),
        ),
});

export const Api = HttpApi.make("app").add(Server.group);

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Server.layer(Api, { defaultReturnTo: "/settings/domains" })),
  Layer.provide([DomainKitLive, IdentityLive]),
);
```

`Server.group` is one `HttpApiGroup` with fifteen typed endpoints covering the whole lifecycle:
inspect, discover, connect, callback, attach, detach, disconnect, plan, approve, reject, apply, read
a plan or a receipt, observe, and build a cleanup plan. `Identity` is the only service you write, and
every handler derives the `Principal` for the request it is serving. `Server.group.prefix("/internal/dns")` moves
every route, and the OAuth callback URL follows the mount. `OpenApi.fromApi(Server.api)` documents
the group.

`/callback/:provider` is the one route the provider drives the browser to, so `Identity` has to
recognise a credential the browser sends on a top-level navigation.

`authorize` is optional and runs after `principal` on every request with the route's name, one of
`Server.EndpointName`. Fail it with reason `Forbidden` for the 403 a UI expects. Omit it and every
authenticated principal reaches every route, which is right when your own middleware already gates
the mount.

After an interactive connection completes, the callback redirects to the `returnTo` the flow was
started with, or to `defaultReturnTo`. The destination is resolved against the callback's own base
and must land on its origin, so neither the provider nor a crafted `returnTo` can steer the customer
off the application. Behind a proxy that rewrites `Host`, set `callbackBaseUrl` to the public base:
the request origin is one the browser never sees, and both the provider's callback URL and the
redirect follow the configured one.

Failures cross the wire as the `DomainKit.Error` value with the status its `reason` derives, so a
`Conflict` is a 409 carrying the conflicting operations and a `Reconnect` is a 403 naming the
connection.

Hosts that are not on Effect's HTTP stack use the Promise edge:

```ts
const { handler, dispose } = Server.toWebHandler(Layer.mergeAll(DomainKitLive, IdentityLive), {
  prefix: "/api/domainkit",
});
```

## Talk to them from the browser

```ts
import { Transport } from "domainkit/client";

const transport = Transport.fromFetch("/api/domainkit");

// Effect at the call site, or `Transport.toAsync(transport)` for Promises.
const started =
  yield *
  transport.connection!.start({
    domain: "app.example.com",
    provider: "cloudflare",
    method: Transport.Method.oauth({ returnTo: "/settings/domains" }),
  });
```

`connection.discover(domain)` answers which of the customer's existing connections already reaches
the domain, so a second domain on a connected provider skips the connect step entirely.
`Snapshot.providers[].methods[]` carries each method's label, docs URL, and token fields, so a
connect form renders from the response instead of hard-coding provider names.

Capability groups are optional. A host that mounts only the connection routes declares
`Transport.fromFetch(url, { capabilities: ["connection"] })`, `Transport.capabilities(transport)`
reports what is there, and the parts of `@domainkit/react` that plan or clean up do not render.
`Transport.fromAsync` adapts a Promise-shaped transport of your own.

Failures arrive as the same `DomainKit.Error` the lifecycle raised, reason intact, so a `Conflict`
still carries its conflicting operations. A response the transport cannot read as a `DomainKit.Error`
becomes a retryable `ProviderUnavailable` naming the base URL.

## Test against the seam

`domainkit/testing` ships `Testing.provider` (a token and OAuth provider over in-memory zones),
`Testing.resolver`, `Testing.storage`, `Testing.transport` (the whole lifecycle over an in-memory
server, recording every call), and the conformance runners, so host tests never stub global
`fetch`. Provider authors run `Testing.conformance.provider(definition, credential, zone)` against
a real account before shipping.

## Public entry points

- `domainkit` — the Effect-native root: lifecycle services, host seams, providers, and values;
- `domainkit/server` — the mountable route group, its layers, and the wire schemas;
- `domainkit/client` — the capability-gated fetch transport and its Promise adapters;
- `domainkit/testing` — fakes and conformance runners;
- `domainkit/<Module>` — every root namespace as its own subpath (`domainkit/Principal`,
  `domainkit/DnsRecord`, ...), the same module instances the root re-exports, for declaration
  emit and bundlers that want the declaring module.

Your app owns identity, tenancy, persistence, keys, routes, and consent. DomainKit supplies the
lifecycle, not a hosted control plane.

## Learn more

- [Executable quickstart](https://github.com/AryaLabsHQ/domainkit/blob/main/packages/domainkit/examples/effect/quickstart.ts)
- [Mounting the routes](https://github.com/AryaLabsHQ/domainkit/blob/main/packages/domainkit/examples/effect/server.ts)
- [Writing a provider](https://github.com/AryaLabsHQ/domainkit/blob/main/packages/domainkit/examples/effect/provider.ts)
- [Architecture decisions](https://github.com/AryaLabsHQ/domainkit/tree/main/packages/domainkit/docs/adr)
- [Issues](https://github.com/AryaLabsHQ/domainkit/issues)

## License

MIT
