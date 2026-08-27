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

Schemas own external parsing. For example, `DomainName.parse` and `DnsRecord.parse` decode and
canonicalize strings through codecs, while encoded protocol dates remain ISO strings and decoded
domain values use `Date`.

See [the architecture decisions](docs/adr/README.md) for the durable rationale and
[CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## License

MIT
