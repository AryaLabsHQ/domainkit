# DomainKit

DomainKit is a provider-independent TypeScript SDK for turning DNS requirements into reviewable,
authorized provisioning plans. Products can connect customer domains without making one
registrar's API or authorization model their architecture.

DomainKit is additive and fail-closed. It creates missing records, treats exact records as no-ops,
reports incompatible state as a conflict, and never silently overwrites DNS. Every applied write is
bound to an approved plan digest and recorded in a receipt that can authorize a separate cleanup.

## Package shape

- `domainkit` — Promise API for application code;
- `domainkit/effect` — canonical Effect-native services and programs;
- `domainkit/adapter` — Promise-shaped contracts for adapter authors;
- `domainkit/effect/adapter` — canonical Effect adapter services and contracts;
- `domainkit/cloudflare` and `domainkit/vercel` — Promise provider adapters;
- `domainkit/effect/cloudflare` and `domainkit/effect/vercel` — Effect provider adapters;
- `domainkit/testing` — in-memory lifecycle capabilities and the provider conformance runner.

The package is portable ESM built on Fetch, Web Crypto, and Web APIs. Effect is a peer dependency.
Promise namespaces delegate to the Effect implementation rather than maintaining another planner,
authorization engine, or verifier.

## Plan, approve, and apply

```ts
import { Provisioning } from "domainkit";

const { plan } = await Provisioning.create({
  provider,
  requirements,
  target: Provisioning.Target.ExactZone({ zone: "example.com" }),
});

// Present plan.operations to the user before authorizing the exact digest.
const authorization = await Provisioning.authorize(plan);
const receipt = await Provisioning.apply({ authorization, plan, provider });
```

Effect applications provide the same capabilities as Layers and run the canonical program
directly:

```ts
import { Effect, Layer } from "effect";
import { DnsProvider } from "domainkit/effect/adapter";
import { Digest, Provisioning } from "domainkit/effect";

const program = Provisioning.create({
  requirements,
  target: Provisioning.Target.ExactZone({ zone: "example.com" }),
}).pipe(
  Effect.provide(Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer)),
);
```

Use `DiscoverFromDomain` when the host has several authorized provider accounts. `ZoneDiscovery`
checks the requested name and its parents, returns `Resolved`, `SelectionRequired`, or `NotFound`,
and never guesses between ambiguous accounts.

## Connect provider accounts

`Connection.start` handles token and interactive provider methods. It returns either `Connected`
or `Redirect`; `Connection.complete` consumes an interactive continuation exactly once. Cloudflare
implements OAuth and token methods. Vercel implements its installation-code flow without
mislabeling it as generic OAuth.

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
import { Verification } from "domainkit";

const result = await Verification.observe({ record });
```

The default resolver pool queries Cloudflare and Google concurrently using RFC wire-format DNS over
HTTPS and applies `AnyMatch`. Results preserve every named answer, negative response, timeout, and
failure. Hosts can supply another resolver pool or choose tagged `AllMatch` and `Quorum` policies.

Authoritative-provider observation is opt-in:

```ts
const result = await Verification.observe({
  provider: Verification.Provider.Enabled({ provider, zone }),
  publicDns: Verification.PublicDns.Disabled(),
  record,
});
```

When both sources are requested, both must match for `Verified`. Every result is exhaustive and
tagged as `NotObserved`, `Pending`, `Mismatch`, `Unavailable`, or `Verified`.

## Write an adapter

Implement the narrow DNS provider contract from `domainkit/adapter` or
`domainkit/effect/adapter`. Then run the deterministic offline contract exported from
`domainkit/testing`:

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
plans, partial receipts, and receipt-bound cleanup. First-party adapters run the same contract and
credential-gated live profiles against disposable records.

Schemas own external and persisted parsing; Effect `Data` values own in-process configuration and
control flow. See [the architecture decisions](docs/adr/README.md),
[provider behavior](docs/providers.md), and [runnable examples](examples/).

## License

MIT
