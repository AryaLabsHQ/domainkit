# 0009: Durable lifecycle over Principal-scoped Storage

## Status

Accepted. Supersedes the Promise facade in [0002](0002-promise-and-effect-apis.md) and
[0006](0006-effect-first-package-root.md), and narrows [0004](0004-host-owned-credentials.md):
the host still owns identity, tenancy, keys, routes, and consent, but DomainKit now owns the
durable lifecycle state and the encryption of credentials at rest.

## Context

The only production host re-implemented what the 0.8 core left to it: a durable attempt record
with leases and replay, credential refresh single-flighting, tenancy re-verification because
`ownerId` was an unenforced string, a provider registry, an error-to-HTTP taxonomy, and a DNS
observation backoff ladder. Twelve of the core namespaces were never used, and the Promise root
duplicated every Effect entry point without being able to type the host's persistence contract.

## Decision

The package root is Effect-native only. One module per concept, each `Foo.Foo` for its tag or
schema: `Provision`, `Cleanup`, `Connect`, and `Verify` are the lifecycle services; `Storage`,
`Custody`, and `Principal` are the host seams; `Provider`, `Providers`, `Cloudflare`, and `Vercel`
describe providers; `DomainName`, `DnsRecord`, `Plan`, `Approval`, and `Receipt` are values;
`DomainKitError` is the one error and `DomainKit.layer` the composed layer. Promise support is
limited to edge adapters (`Storage.layerFromAsync`, `Custody.layerFromAsync`).

`Principal` (`ownerId`, `actorId`) is a required `Context.Service` with no default; every lifecycle
operation and every `Storage` method requires it, so cross-tenant access is unrepresentable.

`Storage` is one Principal-scoped service grouped by noun: authorizations with sealed credentials,
connections, attachments, continuations, attempts, readiness, and a `withLock` single-flight guard.
Plan, approve, and apply are durable attempts (`planned -> approved -> applying -> complete |
partial | failed`) with a lease, so any step can be retried and replays its stored result. Partial
application is a `partial` receipt in the success channel, never an error. Storage never sees
plaintext: `Connect` seals through `Custody`, whose default is AES-256-GCM from one configured key.

A provider is one declarative `Provider.make` value with optional `token`, `oauth`, and
`integration` auth cases, a context schema, and `session(credential)` returning targets and DNS
operations. The registry drives connection routes, refresh, revocation, and the UI method catalog.

Every failure is a `DomainKitError` whose `reason` union derives `category`, `isRetryable`, and
`httpStatus`. Plan digests cover every operation but not requirement labels.

## Consequences

- Hosts write no lifecycle glue: attempts, leases, replay, refresh, continuations, tenancy, and
  backoff are library behaviour behind `DomainKit.layer({ providers })`.
- A Storage implementation must pass `Testing.conformance.storage`; a provider definition must
  pass `Testing.conformance.provider`.
- Non-Effect hosts adapt at the edges instead of consuming a parallel API.
- `Storage` has no per-write progress method, so a crash mid-apply after some writes leaves those
  records without a receipt until the host re-plans; a future revision may add progress rows.

## Alternatives considered

- Keeping durability in the host was rejected: every host rebuilt the same attempt record.
- A single "DomainKit" god service was rejected in favour of focused modules with free-function
  accessors, matching Effect's own module conventions.
- Sealing inside each Storage implementation was rejected because core-side sealing gives every
  implementation, including async host adapters, encryption for free.

## References

- `src/Storage.ts`
- `src/Connect.ts`
- `src/internal/attempts.ts`
- `src/DomainKitError.ts`
- `src/Provider.ts`
- `tests/tracer/lifecycle.test.ts`
