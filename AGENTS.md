# DomainKit agent guide

DomainKit is an open-source TypeScript toolkit for building provider-connected domain setup into a
SaaS product. The product boundary is the safe DNS lifecycle: connect a provider, discover a zone,
build an exact plan, review and approve its digest, apply it, keep a receipt, observe DNS, and run
separately approved receipt-bound cleanup.

This file is a default guide, not an encyclopedia. Read the nearest nested `AGENTS.md` before
changing a scoped surface. Public positioning and forbidden claims live in
`.agents/product-marketing.md`.

## What we never compromise on

- Keep credentials, persistence, identity, tenancy, callback routes, consent, and audit policy in
  the host application. DomainKit does not provide a hosted control plane.
- Plans are additive and fail closed: matching records are `Noop`, missing records are `Create`,
  and incompatible state is `Conflict`. Never describe provider writes as atomic or transactional.
- Apply only an approved plan digest. Cleanup is a separate operation bound to an apply receipt.
- Treat current package exports and packed artifacts as the public contract. Do not expose internal
  modules or copy stale API names into public docs.
- Separate released behaviour from dirty-worktree work. A local implementation or a passing test is
  not evidence of a published package or a production deployment.

## Hit every surface

The common defect is a change that works on one tested path and is missing elsewhere. Say which
entries applied before finishing:

- **Core API** — `packages/domainkit/src`, its `server`, `client`, and `testing` entry points,
  schemas, and tests.
- **React package** — `packages/react`, its browser fixture, and its packed consumers.
- **Providers** — the Cloudflare and Vercel adapters, provider docs, conformance, and provider
  tests.
- **Documentation** — `apps/docs/content`, the reference inventories, navigation, links, and the
  built output. Customer-facing behaviour needs a matching page.
- **Snippet gallery** — `examples/` and `packages/domainkit/examples`. Every code sample the site
  renders is a slice of a file in one of them, so an API change lands here too.
- **Package artifacts** — package manifests, READMEs, declaration and build output, and
  packed-consumer tests when the public API changes.
- **Host integration** — transport, authenticated routes, persistence, and any real consumer when
  the change crosses the application boundary.
- **Deployment** — only when explicitly requested; verify source, artifact, and provider state
  separately. Do not infer a live site from Wrangler configuration.

Public marketing copy follows `.agents/product-marketing.md`, not this file.

## Documentation style

Tracked documentation describes what DomainKit is now and where it is going. It carries no history:
no "was", no "previously", no version comparisons, and no migration notes unless a page is itself a
migration guide. ADRs state current principles and are rewritten or deleted, never marked
superseded. History lives in git.

## Verification

Use Bun scripts from the relevant package. For docs changes, run the reference checker, strict link
and content checks, the audit, the examples typecheck, and the production build. For API changes,
run package tests, typecheck, build, and packed-consumer coverage. Finish with `git diff --check`.
Preserve unrelated changes and avoid broad formatting or destructive cleanup.

## Scoped guides

- `apps/docs/AGENTS.md` — public documentation, Diátaxis classification, reference coverage, the
  snippet gallery, and docs-site verification.
- `packages/domainkit/AGENTS.md` — core exports, provider contracts, and the API-reference source of
  truth.
- `packages/react/AGENTS.md` — React flows, the transport boundary, composition, and the catalog.
