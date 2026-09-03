# 0006: Effect-native package root

## Status

Accepted

## Context

DomainKit's consumers use Effect for typed failures, dependency ownership, and client state. A
parallel Promise API duplicates every entry point, cannot type the host's persistence contract,
and makes the secondary surface look canonical. Effect's own packages set the module conventions
consumers already know.

## Decision

`domainkit` exports one module per concept, each identifier prefixed `@domainkit/`. A service
module exposes `Service` (the tag) and `Interface` (its shape); a value module exposes `Model`
(the schema), so consumers write `Storage.Service` and `Plan.Model`, never `Storage.Storage`.
Lifecycle services are `Provision`, `Cleanup`, `Connect`, and `Verify`; host seams are `Storage`,
`Custody`, and `Principal`; providers are `Provider`, `Providers`, `Cloudflare`, and `Vercel`;
values are `DomainName`, `DnsRecord`, `Plan`, `Approval`, and `Receipt`; `DomainKit.Error` is the
one error and `Reason` its reason union; `Resolver` is the public DNS pool, and
`DomainKit.layer({ providers })` the composed layer that requires `Storage` and `Custody` beneath
it. Free-function accessors (`Provision.plan(...)`) delegate to the service in context. Knobs with
defaults are `Context.Reference` values (`Provision.Policy`, `Connect.Policy`, `Verify.Policy`).

Every failure is a `DomainKit.Error` whose `reason` union derives `category`, `isRetryable`, and
`httpStatus`; class names equal their tags.

Promise support is limited to edge adapters: `Storage.layerFromAsync`, `Custody.layerFromAsync`,
and the server layer's Web handler. `domainkit/testing` ships the fakes and conformance runners;
`domainkit/server` and `domainkit/client` are the host route and browser transport entries. Every
root namespace is also its own subpath (`domainkit/Principal`, `domainkit/DnsRecord`, ...), built
as one ESM file per module so the root and the subpath share module instances; a consumer's
declaration emit names types by that subpath. `package.json` lists each subpath explicitly and
`tests/artifact/exports.test.ts` pins the list to `src/index.ts`. No adapter or compatibility
subpaths exist.

## Consequences

- Effect consumers use the shortest and most obvious import path and keep Layer ownership.
- First-party providers and generic contracts cannot drift across duplicate subpaths.
- `@domainkit/react` and `@domainkit/capsuledb` consume the same schemas and services as the core.
- Non-Effect hosts adapt at the edges instead of consuming a second lifecycle.

## Alternatives considered

- A single aggregate service hides the seams hosts need to override.
- A Promise mirror of the root doubles the surface without adding capability.
- A `./dist/types/*` types-only export makes declarations nameable but exposes the build layout
  and fails at runtime when imported.

## References

- `src/index.ts`
- `src/DomainKit.ts`
- `src/Reason.ts` and `src/internal/error.ts`
- `tests/artifact/exports.test.ts`
