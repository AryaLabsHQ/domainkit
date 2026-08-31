---
name: documentation-authoring
description: Author and repair DomainKit public documentation with source-grounded Diátaxis structure, host-boundary accuracy, and verified API coverage.
---

# DomainKit documentation authoring

Use this skill when writing or reviewing DomainKit README, docs-site, API-reference, provider, or
React integration content. The goal is documentation that helps a SaaS engineer build embedded
domain setup while staying true to the installable package and host-owned security boundary.

## Start with the product boundary

Before drafting, read `.agents/product-marketing.md`, the nearest `AGENTS.md`, the relevant package
manifest, public entry point, tests, and existing page. Treat current source, packed artifacts, and
verified runtime behavior as evidence; label or omit anything that exists only in a dirty worktree.

The public lifecycle is:

1. connect a provider and discover its authoritative zone;
2. create an exact `create` / `noop` / `conflict` plan;
3. let the user review and authorize its digest;
4. apply server-side and persist the receipt;
5. observe provider and public-DNS evidence; and
6. perform separately reviewed, receipt-bound cleanup.

Keep credentials, routes, persistence, identity, tenancy, consent, and audit in the host
application. Do not position DomainKit as a DNS host, registrar, hosted backend, automatic
reconciler, or Domain Connect successor.

## Choose the page's Diátaxis job

- **Tutorial:** learning-oriented and copy-paste runnable. Start credential-free with
  `domainkit/testing`, show expected output, and end with an idempotent second plan.
- **How-to:** task-oriented. Begin with the user's goal, then prerequisites, implementation steps,
  failure modes, and a verification command or observable result.
- **Reference:** information-oriented. Derive symbol inventories from public entry points and
  declarations; hand-author invariants, tagged outcomes, environment requirements, and React
  state/command semantics. Never enumerate internal modules as public API.
- **Explanation:** understanding-oriented. Answer one why question, especially digest-bound plans,
  host-owned credentials, separate cleanup, or provider readback versus public propagation.

Do not force all four genres into one page. Preserve useful URLs and link readers to the next genre.

## Authoring and review checklist

- Lead with the SaaS outcome; use Effect, React, and provider APIs as implementation layers.
- Put prerequisites, host responsibilities, expected output, and failure behavior near the action.
- Use exact lifecycle nouns (`plan`, `digest`, `authorization`, `receipt`, `observation`) and avoid
  unsupported claims such as atomicity, rollback, zero risk, or production adoption.
- When an export changes, update its owning reference inventory, package README, examples, and tests.
- Check all relevant surfaces: core Effect API, Promise facade, testing helpers, React/workshop,
  providers, registry, package artifacts, host transport, and docs navigation.
- Run the narrowest relevant Bun tests/typechecks/builds, the docs reference checker and strict
  site checks for docs work, and `git diff --check`. Inspect the rendered journey for UI changes.
- Preserve unrelated edits; use exact-file formatting and leave publication/deployment claims
  unverified unless the provider and public route have been checked.
