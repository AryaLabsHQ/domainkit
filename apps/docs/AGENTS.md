# DomainKit documentation guide

`apps/docs` is a public technical product surface. Write for a TypeScript SaaS or full-stack
engineer who needs to ship embedded domain setup, not for someone browsing an internal module tree.
Use `.agents/product-marketing.md` as the publication control plane for audience, vocabulary,
evidence, and claim boundaries.

## Page purpose

Give each page one Diátaxis job:

- **Tutorial** — a runnable, deterministic learning path. Prefer the in-memory provider and show the
  expected plan, receipt, and idempotent re-plan before requiring credentials.
- **How-to** — a goal-oriented task such as mounting the route group, connecting Cloudflare, or
  writing a provider. State prerequisites, host-owned responsibilities, and failure behaviour.
- **Reference** — neutral, source-checked facts. Inventories must match the public entry points;
  explain behaviour, tagged states, and options next to the symbols.
- **Explanation** — answer why approval is digest-bound, why cleanup is separate, and why provider
  readback is not public propagation.

Preserve stable URLs when splitting an overloaded page. Link the next useful step rather than
duplicating whole sections across pages.

## Code samples

Never hand-write a code block that claims to be DomainKit usage. Add the code to `examples/` (or use
`packages/domainkit/examples`, which `domainkit release:check` already gates), mark a region, and
render it:

```mdx
<Snippet file="examples/core/plans.ts" region="apply" />
```

`components/snippets.ts` reads only those two trees, so every sample on the site compiles in CI.
`<Component path="registry/domain-flow" />` renders `apps/docs/examples/registry/domain-flow.tsx`
live in its own frame. Every registry preview mounts `lib/preview-flow.tsx`, which builds a
`Testing.transport` in that frame, so clicking through a preview runs the real lifecycle.

## Accuracy rules

- The golden architecture is host-owned: authenticated routes, credential custody, durable stores,
  identity and tenancy, consent, and audit stay outside DomainKit.
- Do not claim DomainKit is a DNS host, registrar, automatic reconciler, hosted backend, or a Domain
  Connect successor. Do not claim unpublished worktree APIs are in the released package.
- Keep the homepage promise focused on building domain setup into SaaS; reviewable plans are the
  proof mechanism. Effect and React are delivery layers, not the product category.
- The registry is the one styled path. `@domainkit/react` renders no element, so no page describes a
  packaged component, a part, a theme token, or a marks map.
- Generate inventories from `packages/domainkit/src/index.ts`, `src/entry/server.ts`,
  `src/entry/client.ts`, `src/entry/testing.ts`, `packages/react/src/index.ts`, and
  `packages/capsuledb/src/index.ts`. Hand-author semantics; never list an internal module as public.
- Pages describe the current API only. No version comparisons and no migration notes.

## Checks

From this directory: `bun run reference:check`, `bun run typecheck`, `bun run test`,
`bun run build`, `./node_modules/.bin/blume validate --strict`, `bun run audit --strict`, and
`bun run registry:check`. From the repository root: `bun run typecheck:examples`. Inspect the
rendered primary journeys when navigation or UI changes.

`bun run test` runs the snippet reader and the browser spec. `test:snippets` pins the reader that
slices the samples: region names match whole, because several names in the gallery are prefixes of
another. `test:browser` drives the registry block in Chrome over `Testing.transport`, through
`tests/browser/app`, a Vite fixture with no Tailwind build: the few positional rules the utility
classes would have supplied live in `tests/browser/app/fixture.css`, and everything else is
deliberately unstyled, because that run is about behaviour, focus, and portals.

`registry:check` installs every built item into a scratch shadcn project on the `base-nova` style,
against tarballs packed from this branch, then typechecks and builds it. The display items are also
scanned for a managed-runtime import: `dns-table`, `dns-operation`, `dns-status`, `provider-mark`,
`copy-value`, and `async-state` must import no `domainkit`, Effect, or transport.

`audit --strict` fails on warnings, so a page needs a 110–160 character `description`, a rendered
title of 60 columns or fewer, and at least one link to it from another page's body.
