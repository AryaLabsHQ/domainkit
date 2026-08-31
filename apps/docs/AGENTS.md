# DomainKit documentation guide

`apps/docs` is a public technical product surface. Write for a TypeScript SaaS or full-stack
engineer who needs to ship embedded domain setup, not for someone browsing an internal module tree.
Use `.agents/product-marketing.md` as the publication control plane for audience, vocabulary,
evidence, and claim boundaries.

## Page purpose

Give each page one Diátaxis job:

- **Tutorial** — a runnable, deterministic learning path. Prefer the in-memory provider and show
  expected plan, receipt, and idempotent re-plan results before requiring credentials.
- **How-to** — a goal-oriented task such as wiring a host transport, connecting Cloudflare, or
  implementing a provider. State prerequisites, host-owned responsibilities, and failure behavior.
- **Reference** — neutral, source-checked facts. Inventories must match public entry points; explain
  behavior, tagged states, environment requirements, and React commands next to the symbols.
- **Explanation** — answer why the lifecycle is digest-bound, why cleanup is separate, and why
  provider readback is different from public DNS propagation.

Preserve stable URLs when splitting an overloaded page. Link the next useful step rather than
duplicating whole sections across pages.

## Accuracy rules

- The golden architecture is host-owned: authenticated routes, credential custody, durable stores,
  identity/tenancy, consent, and audit remain outside DomainKit.
- Do not claim DomainKit is a DNS host, registrar, automatic reconciler, hosted backend, or Domain
  Connect successor. Do not claim unpublished worktree APIs are part of the released package.
- Keep the homepage promise focused on building domain setup into SaaS; reviewable plans are the
  proof mechanism. Effect and React are delivery layers, not the product category.
- Generate inventories from `packages/domainkit/src/index.ts`, `promise.ts`, `testing.ts`, and
  `packages/react/src/index.ts`. Hand-author semantics; never list internal-only modules as public.

## Checks

From this directory, run `bun run reference:check`, `./node_modules/.bin/blume validate --strict`,
`bun run audit --strict`, `bun run check --isolated --strict`, and `bun run build`. Also run example typechecks
when tutorials change and inspect the rendered primary journeys when UI/navigation changes.
