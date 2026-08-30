# DomainKit

DomainKit is a provider-independent TypeScript SDK for turning DNS requirements into reviewable,
authorized provisioning plans. Products can connect customer domains without making one
registrar's API or authorization model their architecture.

DomainKit is additive and fail-closed. It creates missing records, treats exact records as no-ops,
reports incompatible state as a conflict, and never silently overwrites DNS. Every applied write is
bound to an approved plan digest and recorded in a receipt that can authorize a separate cleanup.

## Package shape

- `domainkit` — canonical Effect services, programs, schemas, and first-party providers;
- `domainkit/promise` — secondary Promise facade for foreign runtime boundaries;
- `domainkit/testing` — in-memory lifecycle capabilities and the provider conformance runner.

The package is portable ESM built on Fetch, Web Crypto, and Web APIs. Effect is a peer dependency.
Promise namespaces delegate to the Effect implementation rather than maintaining another planner,
authorization engine, or verifier. There are no provider-specific subpaths: `Cloudflare` and
`Vercel` are cohesive namespaces on each root.

## Plan, approve, and apply

```ts
import { Effect, Layer } from "effect";
import { Digest, DnsProvider, Provisioning } from "domainkit";

const program = Provisioning.create({
  requirements,
  target: Provisioning.Target.ExactZone({ zone: "example.com" }),
}).pipe(
  Effect.flatMap(({ plan }) =>
    Provisioning.authorize(plan).pipe(
      Effect.flatMap((authorization) => Provisioning.apply({ authorization, plan })),
    ),
  ),
  Effect.provide(Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer)),
);
```

Promise consumers use the explicit secondary entry point at a JavaScript boundary:

```ts
import { Provisioning } from "domainkit/promise";

const { plan } = await Provisioning.create({
  provider,
  requirements,
  target: Provisioning.Target.ExactZone({ zone: "example.com" }),
});
```

Use `DiscoverFromDomain` when the host has several authorized provider accounts. `ZoneDiscovery`
checks the requested name and its parents, returns `Resolved`, `SelectionRequired`, or `NotFound`,
and never guesses between ambiguous accounts.

## Connect provider accounts

`Connection.start` handles token and interactive provider methods. It returns either `Connected`
or `Redirect`; `Connection.complete` consumes an interactive continuation exactly once. Cloudflare
implements OAuth and token methods. Vercel implements its installation-code flow without
mislabeling it as generic OAuth.

After a host proves that an existing connected account owns another domain and obtains the owner's
consent, `Connection.extend` adds that domain to the existing owner grant without repeating provider
authentication. It preserves earlier domain grants and rejects cross-owner, expired, or revoking
connections.

Cloudflare can discover the selected account from a domain already visible to the credential, so a
customer does not need to find or type an account ID. Vercel retains explicit personal or team
context returned by the installation. Both contexts are versioned, non-secret values that can
reconstruct the correct provider client later.

Hosts provide one `AuthorizationLifecycle` repository for an authorization aggregate, its
credential, and its owner bindings. SQL hosts can implement one transaction; split database and
vault hosts can implement a recoverable saga behind the same interface. Interactive continuations
remain separate, short-lived, one-time state. DomainKit does not choose a database, cache, vault,
callback route, session model, consent UI, or audit system.

Provider scope claims are not treated as proof. Each required capability carries `Declared`,
`Introspected`, or `Exercised` evidence. Final-binding revocation is fail-closed: durable state
remains retryable until the provider confirms revocation.

## Observe DNS

`Verification.observe` is the only verification operation. Public DNS is the default:

```ts
import { Effect } from "effect";
import { DnsProvider, Verification } from "domainkit";

const result = await Effect.runPromise(Verification.observe({ record }));
```

The default resolver pool queries Cloudflare and Google concurrently using RFC wire-format DNS over
HTTPS and applies `AnyMatch`. Results preserve every named answer, negative response, timeout, and
failure. Hosts can supply another resolver pool or choose tagged `AllMatch` and `Quorum` policies.

Authoritative-provider observation is opt-in:

```ts
const result = await Verification.observe({
  provider: Verification.Provider.Enabled({ zone }),
  publicDns: Verification.PublicDns.Disabled(),
  record,
}).pipe(Effect.provideService(DnsProvider.Service, provider), Effect.runPromise);
```

When both sources are requested, both must match for `Verified`. Every result is exhaustive and
tagged as `NotObserved`, `Pending`, `Mismatch`, `Unavailable`, or `Verified`.

## Implement a DNS provider

Implement the narrow `DnsProvider` contract exported from `domainkit`. Then
run the deterministic offline contract exported from `domainkit/testing`:

```ts
import { Effect } from "effect";
import { DomainName } from "domainkit";
import { ProviderConformance } from "domainkit/testing";

const report = await Effect.runPromise(
  ProviderConformance.run({
    makeProvider: ProviderConformance.fromAsync(() => makeFreshPromiseProvider()),
    zone: DomainName.parse("example.com"),
  }),
);
```

The contract covers complete readback across provider pages, exact no-op, conflict, create, stale
plans, partial receipts, and receipt-bound cleanup. First-party providers run the same contract and
credential-gated live profiles against disposable records.

Schemas own external and persisted parsing; Effect `Data` values own in-process configuration and
control flow. See [the architecture decisions](docs/adr/README.md),
[provider behavior](docs/providers.md), and [runnable examples](examples/).

## License

MIT
