# 0006: Effect-native package root

## Status

Accepted

## Context

DomainKit's consumers use Effect for typed failures, dependency ownership, and client state. A
parallel Promise API duplicates every entry point, cannot type the host's persistence contract,
and makes the secondary surface look canonical. Effect's own packages set the module conventions
consumers already know.

## Decision

`domainkit` exports one module per concept, each `Foo.Foo` for its service tag or schema and each
identifier prefixed `@domainkit/`. Lifecycle services are `Provision`, `Cleanup`, `Connect`, and
`Verify`; host seams are `Storage`, `Custody`, and `Principal`; providers are `Provider`,
`Providers`, `Cloudflare`, and `Vercel`; values are `DomainName`, `DnsRecord`, `Plan`,
`Approval`, and `Receipt`; `DomainKitError` is the one error, `Resolver` the public DNS pool, and
`DomainKit.layer({ providers })` the composed layer that requires `Storage` and `Custody` beneath
it. Free-function accessors (`Provision.plan(...)`) delegate to the service in context. Knobs with
defaults are `Context.Reference` values (`Provision.Policy`, `Connect.Policy`, `Verify.Policy`).

Every failure is a `DomainKitError` whose `reason` union derives `category`, `isRetryable`, and
`httpStatus`; class names equal their tags.

Promise support is limited to edge adapters: `Storage.layerFromAsync`, `Custody.layerFromAsync`,
and the server layer's Web handler. `domainkit/testing` ships the fakes and conformance runners;
`domainkit/server` and `domainkit/client` are the host route and browser transport entries. No
provider, adapter, or compatibility subpaths exist.

## Consequences

- Effect consumers use the shortest and most obvious import path and keep Layer ownership.
- First-party providers and generic contracts cannot drift across duplicate subpaths.
- `@domainkit/react` and `@domainkit/capsuledb` consume the same schemas and services as the core.
- Non-Effect hosts adapt at the edges instead of consuming a second lifecycle.

## Alternatives considered

- A single aggregate service hides the seams hosts need to override.
- A Promise mirror of the root doubles the surface without adding capability.
- Provider subpaths duplicate what the root namespaces already provide.

## References

- `src/index.ts`
- `src/DomainKit.ts`
- `src/DomainKitError.ts`
- `tests/artifact/exports.test.ts`
