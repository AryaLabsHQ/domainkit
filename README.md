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
- `domainkit/vercel` — Promise-based Vercel authoritative-DNS adapter;
- `domainkit/effect/vercel` — canonical Effect-native Vercel adapter;
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

The Cloudflare authorization helpers can discover the account selected by an OAuth grant or API
token from a domain the host already owns. They walk from the requested name to its registrable
domain, require exactly one accessible authoritative zone, and return its Cloudflare account ID.
Hosts therefore do not need to ask users to find or paste an account ID. The host still declares
the capabilities required when the credential was issued because Cloudflare's non-mutating token
verification endpoint cannot infer DNS write permission:

```ts
import { Cloudflare, DomainName } from "domainkit";

const resolveSubject = Cloudflare.Auth.subjectResolver({
  capabilities: ["dns:read", "dns:write"],
  domain: DomainName.parse("mail.customer.example.com"),
});
```

Once authorized, the DNS client remains explicitly account-scoped. The host supplies the discovered
account ID with its stored credential. The adapter creates DNS-only records and leaves credential
storage and user interaction to the host:

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
API-token capability. Explicit `accountId` authorization remains available for hosts that already
have a trusted account selection.

The Vercel adapter accepts either explicit personal or team context. It supports personal access
tokens and Vercel's integration-code exchange without treating that provider-specific installation
flow as generic OAuth:

```ts
import { Secret, Vercel } from "domainkit";

const provider = Vercel.make({
  capabilities: ["dns:read", "dns:write"],
  context: { _tag: "team", teamId: "team-id" },
  token: Secret.make(apiToken),
});
```

`listAccounts()` returns the distinct accounts represented by zones visible to the credential.
Accounts with no visible zones are not returned because Cloudflare does not document bearer-token
authentication for its separate account-list endpoint.

Schemas own external parsing. For example, `DomainName.parse` and `DnsRecord.parse` decode and
canonicalize strings through codecs, while encoded protocol dates remain ISO strings and decoded
domain values use `Date`.

See [the architecture decisions](docs/adr/README.md) for the durable rationale and
[the provider contract](docs/providers.md) for adapter differences. Runnable TypeScript examples
cover [manual Promise provisioning](examples/promise/manual-provider.ts),
[token connections](examples/promise/cloudflare-token.ts),
[Cloudflare OAuth](examples/promise/cloudflare-oauth.ts),
[Vercel integration exchange](examples/promise/vercel-integration.ts), and
[Effect-native provisioning](examples/effect/provisioning.ts). See
[CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## License

MIT
