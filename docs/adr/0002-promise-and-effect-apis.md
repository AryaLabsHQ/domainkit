# 0002: Promise and Effect APIs

## Status

Accepted

## Context

Effect applications need typed failures, explicit environments, and caller-owned Layers. Ordinary
TypeScript applications need the same DomainKit behavior without adopting Effect as their
application architecture. Maintaining two implementations would allow planning, authorization, and
verification semantics to drift.

## Decision

Effect-native services and programs are the canonical implementation and are exported from
`domainkit/effect`. The package root exposes capability-based Promise namespaces over those same
programs. Effect remains a peer dependency so hosts control the compatible Effect 4 installation.

Each Effect service module owns its `Interface`, `Service` tag, Layers, and named `Effect.fn`
operations. Promise functions build bridge Layers and call `Effect.runPromise` only at the
JavaScript boundary. `Effect.tryPromise` is reserved for foreign Promise APIs such as Fetch,
`oauth4webapi`, and caller-provided provider or store callbacks.

DomainKit does not expose an aggregate client or own a hidden runtime because it has no default
provider, credential store, or persistence graph. Unknown IO values are schema-decoded before
entering domain logic; comparison and rendering remain pure over decoded values.

## Consequences

- Promise and Effect consumers share one behavioral implementation and failure model.
- Effect consumers retain explicit runtime and Layer ownership.
- Promise bridges are deliberate runtime exits and foreign async boundaries remain auditable.
- Consumers must provide provider, store, crypto, resolver, and transport capabilities required by
  the workflow they execute.

## Alternatives considered

- A Promise-native core was rejected because it would erase typed environments and make the Effect
  API a reconstruction rather than the canonical program.
- An Effect-only package was rejected because it would unnecessarily narrow adoption.
- A runtime-owning aggregate client was rejected because DomainKit cannot choose host authority or
  resource lifetime safely.

## References

- `src/effect.ts`
- `src/index.ts`
- `src/promise/`
- `tools/oxlint/`
- `tests/artifact/packed-consumers.test.ts`
