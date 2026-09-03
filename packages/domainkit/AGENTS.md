# Core package guide

The package root is the canonical Effect API. Public entry points are `domainkit` and
`domainkit/testing`, as declared in `package.json`; `domainkit/server` and `domainkit/client`
arrive with the server layer. The source entry files (`src/index.ts`, `src/entry/testing.ts`) and
packed artifact tests are authoritative; `src/internal/**` and superseded ADR examples are not
public API.

## Public contract

- One module per concept: services expose `Service` (the tag) and `Interface` (its shape), value
  modules expose `Model` (the schema); free-function accessors delegate
  to the service in context. Do not add a god service or a Promise mirror.
- Keep the additive, fail-closed plan model (`Create`, `Noop`, `Conflict`) and digest-bound
  approval intact. Cleanup builds its plan from a receipt and has its own approval and receipt.
- Every operation fails with `DomainKit.Error`; add a class to `Reason` rather than a new error.
- Every `Storage` method and lifecycle operation requires `Principal`; never add a method that
  reads across owners. Storage stores sealed credentials only; `Connect` seals through `Custody`.
- Provider adapters are `Provider.make` values over the kept protocol and record codecs; Cloudflare
  and Vercel capabilities must be supported by source and tests before they appear in public docs.
- Storage implementations pass `Testing.conformance.storage`; providers pass
  `Testing.conformance.provider`.

## Documentation and verification

When exports change, update the owning `apps/docs/content/reference` inventory and run the docs
reference checker. Update the README, `examples/`, and `tests/artifact` for published-surface
changes. Run `bun run release:check` in this package (typecheck, test, build, examples, packed
artifacts); finish with `git diff --check`.
