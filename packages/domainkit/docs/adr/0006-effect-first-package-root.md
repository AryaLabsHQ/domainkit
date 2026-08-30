# 0006: Effect-first package root

## Status

Accepted

## Context

DomainKit's intended consumers already use Effect for typed failures, dependency ownership, and
client state. Exporting Promise functions from the package root made the secondary compatibility
surface appear canonical, duplicated provider entry points, and forced Effect consumers onto an
extra subpath.

The React package also needs one canonical, schema-backed application transport contract instead
of maintaining structurally similar wire types independently.

## Decision

`domainkit` exports the Effect-native domain programs, services, schemas, first-party provider
namespaces, and the application-facing `Transport` service. `domainkit/promise` is the explicit
secondary facade for foreign runtimes that require Promise callbacks. `domainkit/testing` remains
the test-support entry point.

Cloudflare and Vercel stay as namespaces on the Effect and Promise roots. DomainKit does not expose
provider-specific, `effect`, adapter, or compatibility subpaths.

Serialized transport values are schema-backed. In-process connection choices use
`Data.taggedEnum`, so callers construct `Transport.Method.OAuth()` or
`Transport.Method.Token(...)` rather than hand-authoring `_tag`. `Transport.layerFromAsync`
converts a host's unavoidable Promise boundary into the canonical Effect service.

## Consequences

- Effect consumers use the shortest and most obvious import path.
- Promise use remains supported but is visually and architecturally secondary.
- First-party providers and generic contracts cannot drift across duplicate subpaths.
- `@domainkit/react` can consume the same transport schemas and service as the core package.
- This is a breaking package-surface change targeted at `0.3.0`.

## Alternatives Considered

- Keeping `domainkit/effect` was rejected because it preserved the wrong canonical hierarchy.
- Keeping provider subpaths was rejected because the root namespaces already provide the complete
  first-party integrations.
- Removing Promise support entirely was rejected because framework actions and other foreign
  boundaries still benefit from a small explicit bridge.

## References

- `src/index.ts`
- `src/promise.ts`
- `src/transport.ts`
- `tests/artifact/packed-consumers.test.ts`
