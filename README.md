# DomainKit

DomainKit is a provider-independent TypeScript SDK for turning DNS requirements into reviewable,
authorized provisioning plans. It is intended for products that need to connect customer domains
without making registrar-specific APIs their product architecture.

## Direction

DomainKit separates four concerns:

1. a portable, versioned DNS plan and receipt format;
2. explicit authorization for the exact operations being applied;
3. provider adapters that reconcile and apply records;
4. host-owned credentials, persistence, routes, and user interaction.

## Package shape

- `domainkit` — Promise-based API for application code;
- `domainkit/effect` — canonical Effect-native services and programs;
- `domainkit/cloudflare` — Promise-based Cloudflare authoritative-DNS adapter;
- `domainkit/effect/cloudflare` — canonical Effect-native Cloudflare adapter;
- `domainkit/testing` — deterministic provider and store implementations for tests.

The package is portable ESM built on Fetch and Web APIs. Effect is a peer dependency.

Both entry points are organized by capability namespaces. The root API accepts ordinary async
providers and stores:

```ts
import { Provisioning } from "domainkit";

const plan = await Provisioning.create({
  provider: {
    id: "my-provider",
    listRecords: async (zone) => listDnsRecords(zone),
    createRecord: async (zone, record) => createDnsRecord(zone, record),
  },
  requirements,
  zone: "example.com",
});
```

Effect applications provide the same capabilities as Layers and run the canonical program
directly:

```ts
import { Effect, Layer } from "effect";
import { Digest, DnsProvider, Provisioning } from "domainkit/effect";

const program = Provisioning.create({ requirements, zone: "example.com" }).pipe(
  Effect.provide(Layer.merge(DnsProvider.layerFromAsync(provider), Digest.webCryptoLayer)),
);
```

The Promise namespaces delegate to the canonical Effect programs rather than maintaining a second
planning, authorization, or verification implementation. Hosts supply providers and stores
explicitly; DomainKit does not own a hidden runtime.

The Cloudflare adapter accepts a host-owned API or OAuth token and an explicitly selected account.
The host also declares the capabilities required when that credential was issued; Cloudflare's
non-mutating token-verification endpoint cannot infer DNS write permission. The adapter creates
DNS-only records and leaves credential storage and user interaction to the host:

```ts
import { Cloudflare, Provisioning, Secret } from "domainkit";

const provider = Cloudflare.make({
  accountId: "cloudflare-account-id",
  capabilities: ["dns:read", "dns:write"],
  token: Secret.make(apiToken),
});

const plan = await Provisioning.create({ provider, requirements, zone: "example.com" });
```

OAuth helpers own Cloudflare's endpoints and client-auth variants while accepting the scope IDs
assigned during OAuth client registration. `Cloudflare.Auth.tokenMethod` describes the equivalent
API-token capability.

`listAccounts()` returns the distinct accounts represented by zones visible to the credential.
Accounts with no visible zones are not returned because Cloudflare does not document bearer-token
authentication for its separate account-list endpoint.

Schemas own external parsing. For example, `DomainName.parse` and `DnsRecord.parse` decode and
canonicalize strings through codecs, while encoded protocol dates remain ISO strings and decoded
domain values use `Date`.

See [the architecture decisions](docs/adr/README.md) for the durable rationale and
[CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## License

MIT
