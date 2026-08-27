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

The initial provider work will target Cloudflare and Vercel. Manual DNS instructions remain a
permanent fallback. Domain Connect can be supported later as a compatibility adapter, but it is not
the core abstraction.

## Package shape

- `domainkit` — Promise-based API for application code;
- `domainkit/effect` — canonical Effect-native services and programs;
- `domainkit/testing` — deterministic provider and store implementations for tests.

The package is portable ESM built on Fetch and Web APIs. Effect is a peer dependency. Executor is
not required; a later optional bridge can implement DomainKit's host interfaces.

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

The Promise namespace functions provide bridge Layers and call `Effect.runPromise`; they do not
maintain a second planning, authorization, or verification implementation. Effect services use the
same module shape throughout: `Interface`, `Service`, `layer...`, and named `Effect.fn` operations
live behind the owning namespace.

Schemas own external parsing. For example, `DomainName.parse` and `DnsRecord.parse` decode and
canonicalize strings through codecs, while encoded protocol dates remain ISO strings and decoded
domain values use `Date`.

## v0.1 boundary

The first release will create missing records, report exact no-ops, and fail closed on conflicts.
It will not update or delete DNS records. Plans and authorizations are digest-bound so a host cannot
silently apply operations the user did not approve.

DNS providers do not share a transactional write primitive. DomainKit revalidates each approved
create and reports any successful writes in a typed partial receipt if a later operation fails,
allowing the host to reconcile and resume without destructive rollback.

See [the architecture decisions](docs/adr/README.md) for the durable rationale and
[CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## License

MIT
