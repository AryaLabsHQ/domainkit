---
name: seo
description: Research and improve DomainKit's organic and AI search visibility. Use for keyword and intent research, clustering keywords to pages, JSON-LD and metadata, internal linking, and Search Console readback. Live evidence goes through Executor.
---

# SEO

Read `.agents/marketing/truth.md`, `positioning.md`, and `voice.md` before touching copy, titles, or
claims. Truth wins on conflict.

## Evidence routing (Executor, read-only)

1. **OpenSEO first** for keyword, SERP, and competitor estimates.
2. **DataForSEO** (`dataforseo_api`) only when OpenSEO cannot answer; it is paid.
3. **Search Console** for owned data: property `sc-domain:domain-kit.dev`.
4. **Exa** through Executor for page and forum research.

Discover tools at runtime through Executor. Log every paid call (tool, query, estimated cost) in the
research file it fed, and reuse recent results before paying again. Label every datum as owned,
provider estimate, observed (dated), or inference; never blend them.

## Keyword and cluster method

1. Seed from customer words (`voice.md`) and the target terms in `positioning.md`.
2. Pull volume, difficulty, and the live SERP. Read who ranks: if the results are forum threads and
   listicles, a specific page can win; if they are vendor homepages for a different buyer, the term
   is do-not-target.
3. Cluster by intent (learn, compare, do) and assign one owning page per cluster. A term with no
   measurable volume is chosen by fit, not by count.
4. Record the cluster, owner page, and evidence in `.scratchpad/research/`.

## Schema

Blume 1.5.3 emits `WebSite` everywhere and `TechArticle` on docs pages. Add only truthful nodes:
`SoftwareSourceCode` (MIT, `codeRepository` `https://github.com/AryaLabsHQ/domainkit`,
`programmingLanguage` TypeScript) and `Organization` on the homepage, `BreadcrumbList` on docs pages.
`FAQPage` only where a real, visible FAQ exists. No `HowTo`. Blume 2 adds `seo.organization` and
`seo.software`; upgrading is its own PR.

## Interlinking

Every page needs at least one inbound body link (`bun run audit --strict` enforces it). Link
definition-first from guides to reference and from comparison pages to the provider pages they
concern. Use descriptive anchors in customer words. Verify with `pagegraph links verify`
(`web-audit`).

## Measure

Baseline with `web-audit` before a change, read Search Console after indexing (weeks, not days), and
compare with `pagegraph diff`. A submitted URL is not necessarily crawled, indexed, or ranking.
