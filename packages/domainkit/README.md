# DomainKit

Add custom domains to a TypeScript SaaS application.

DomainKit turns DNS requirements into plans you can review, requires approval for the exact plan
before a write, records applied changes in receipts, and uses those receipts to plan cleanup. It
supports Cloudflare and Vercel without making either provider's API your product architecture.

## Install

```sh
npm install domainkit effect@rc
```

Node.js 24.10 or newer and Effect 4 are required.

## Plan, approve, and apply

```ts
import { Digest, DnsRecord, DomainName, Provisioning } from "domainkit";
import { InMemoryDnsProvider } from "domainkit/testing";
import { Effect, Layer } from "effect";

const requirement = DnsRecord.Cname({
  metadata: {
    ownership: "customer",
    provenance: "product-onboarding",
    purpose: "tracking",
  },
  name: DomainName.parse("track.example.com"),
  policy: "exclusive",
  target: DomainName.parse("tracking.example.net"),
  ttl: 300,
});

const program = Effect.gen(function* () {
  const { plan } = yield* Provisioning.create({
    requirements: [requirement],
    target: Provisioning.Target.ExactZone({
      zone: DomainName.parse("example.com"),
    }),
  });
  const authorization = yield* Provisioning.authorize(plan);
  return yield* Provisioning.apply({ authorization, plan });
}).pipe(Effect.provide(Layer.merge(InMemoryDnsProvider.layer(), Digest.webCryptoLayer)));
```

Planning is additive and fail-closed: exact records become no-ops, missing records become creates,
and incompatible state becomes a conflict. DomainKit never silently overwrites DNS.

Tagged values use callable case constructors such as `DnsRecord.Txt({...})` and
`DnsPlan.Operation.create({...})`; use the exported schemas when decoding persisted or provider
data.

## Public entry points

- `domainkit` — Effect services, schemas, plans, providers, and verification;
- `domainkit/promise` — Promise API for apps that use async/await;
- `domainkit/server` — provider connection routes and an async Web handler factory;
- `domainkit/testing` — in-memory services and provider tests.

Your app owns provider credentials, OAuth state, saved connections, plans, receipts, authorization,
and audit history. DomainKit supplies the domain model and operations, not a hosted control plane.
Cloudflare's provider namespace includes credential refresh; the host owns refresh locking,
encrypted rotation, retry policy, and reconnect UX.

## Learn more

- [Executable quickstart](https://github.com/AryaLabsHQ/domainkit/blob/main/packages/domainkit/examples/effect/quickstart.ts)
- [Architecture decisions](https://github.com/AryaLabsHQ/domainkit/tree/main/docs/adr)
- [Provider behavior](https://domain-kit.dev/docs/reference/providers)
- [Examples](https://github.com/AryaLabsHQ/domainkit/tree/main/packages/domainkit/examples)
- [Issues](https://github.com/AryaLabsHQ/domainkit/issues)

## License

MIT
