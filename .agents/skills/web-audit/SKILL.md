---
name: web-audit
description: Audit DomainKit's public site with pagegraph (audit, links verify, inspect --live, diff) and Blume's own checks. Use for canonical, structured-data, link-graph, and regression checks before and after SEO or copy changes.
---

# Web audit

Audit only unauthenticated public URLs. pagegraph lives at `~/Developer/pagegraph`; run it with
`bun ~/Developer/pagegraph/dist/cli.js <subcommand>`.

## What works on this site

DomainKit's site is Astro and Blume, not TanStack Start, so only the framework-independent
pagegraph commands apply:

| Command                       | Use                                                               |
| ----------------------------- | ----------------------------------------------------------------- |
| `audit <url...> --probe-only` | Canonical, head, and structural findings (Lighthouse is optional) |
| `links verify <url>`          | Rendered link graph: orphans, contextual edges, depth             |
| `inspect <url> --live`        | One page's live head and JSON-LD                                  |
| `diff before.json after.json` | Semantic regressions between two audit artifacts                  |

The graph commands (`check`, `graph`, `sitemap`, `robots`, `plan`, `improve`, `research`) need a
TanStack `seo.config.ts` and do not run here.

## Workflow

1. Run `bun run build` in `apps/docs`, then serve the output (`wrangler dev` or `blume preview`).
   `packages/*/dist` must be current first (`bun run build` at the repository root), or the docs build
   fails.
2. Audit the local server, save the JSON artifact, and repeat against production after a deploy.
3. `diff` the two artifacts. New structural findings block; editorial findings are triaged against
   `voice.md`.
4. Blume's own gates run alongside: `./node_modules/.bin/blume validate --strict` and
   `bun run audit --strict` from `apps/docs`.

Known caveat: `blume audit` against a stale `dist` reports 404s for pages that no longer exist.
Rebuild before trusting it.
