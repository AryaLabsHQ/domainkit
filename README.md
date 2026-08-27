# DomainKit

DomainKit is a provider-independent TypeScript SDK for turning DNS requirements into reviewable,
authorized provisioning plans. It is intended for products that need to connect customer domains
without making registrar-specific APIs their product architecture.

The project is pre-release. Version `0.0.1` reserves the package while the first public contract is
built.

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
