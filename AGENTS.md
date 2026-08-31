# DomainKit agent guide

DomainKit is an open-source TypeScript toolkit for building provider-connected domain setup into a
SaaS product. The product boundary is the safe DNS lifecycle: connect a provider, discover a zone,
build an exact plan, review and authorize its digest, apply it, preserve a receipt, observe DNS,
and perform separately reviewed receipt-bound cleanup.

This file is a default guide, not an encyclopedia. Read the nearest nested `AGENTS.md` before
changing a scoped surface. Public positioning and forbidden claims live in
`.agents/product-marketing.md`.

## What we never compromise on

- Keep credentials, persistence, identity, tenancy, callback routes, consent, and audit policy in
  the host application. DomainKit does not provide a hosted control plane.
- Plans are additive and fail closed: matching records are `noop`, missing records are `create`,
  and incompatible state is `conflict`. Never describe provider writes as atomic or transactional.
- Apply only an explicitly authorized plan digest. Cleanup is a separate operation bound to an
  apply receipt.
- Treat current package exports and packed artifacts as the public contract. Do not expose internal
  modules or copy stale API names into public docs.
- Separate released behavior from dirty-worktree work. A local implementation or passing test is
  not evidence of a published package or production deployment.

## Hit every surface

The common defect is a change that works on one tested path and is missing elsewhere. Say which
entries applied before finishing:

- **Core API** — `packages/domainkit/src`, its Effect/Promise/testing entry points, schemas, and tests.
- **React package** — `packages/react`, examples, workshop, registry, and browser tests.
- **Providers** — Cloudflare/Vercel adapters, capability docs, conformance, and provider tests.
- **Documentation** — `apps/docs/content`, reference inventories, navigation, links, and generated
  output. Customer-facing behavior needs a matching page.
- **Package artifacts** — package manifests, READMEs, declaration/build output, and packed-consumer
  tests when the public API changes.
- **Host integration** — transport, authenticated routes, persistence, and any real consumer when
  the change crosses the application boundary.
- **Deployment** — only when explicitly requested; verify source, artifact, and provider state
  separately. Do not infer a live site from Wrangler configuration.

Public marketing copy follows `.agents/product-marketing.md`, not this file.

## Verification

Use Bun scripts from the relevant package. For docs changes, run the reference checker, strict link
and content checks, audit, examples/typecheck where applicable, and the production build. For API
changes, run package tests, typecheck, build, and packed-consumer coverage. Finish with
`git diff --check`. Preserve unrelated changes and avoid broad formatting or destructive cleanup.

## Scoped guides

- `apps/docs/AGENTS.md` — public documentation, Diátaxis classification, reference coverage, and
  docs-site verification.
- `packages/domainkit/AGENTS.md` — core exports, Effect/Promise boundaries, provider contracts, and
  API-reference source of truth.
- `packages/react/AGENTS.md` — React flows, transport boundary, composition, examples, and UI docs.
