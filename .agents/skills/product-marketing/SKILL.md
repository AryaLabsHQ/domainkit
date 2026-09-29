---
name: product-marketing
description: Own DomainKit's marketing canon (.agents/marketing) and the research-to-measure pipeline for pages and campaigns, with approval gates. Use to research the ICP, shape the story, maintain claims and the proof registry, or run a page through research, copy, design, ship, and measure.
---

# Product marketing

Owns `.agents/marketing/` and sequences `copywriting`, `seo`, `web-audit`, and
`documentation-authoring`. `truth.md` says what may be claimed, `positioning.md` says who it is for
and the story, `voice.md` says how it sounds, and `proof-registry.md` holds the evidence. Truth wins
on conflict.

## Rules

1. **Released artifacts decide what ships.** Read versions from npm at ship time. A working-tree
   feature, a plan, or an existing page is intent, not truth.
2. **One owner per fact.** Evidence goes in the proof registry; the canon names it instead of copying
   it. No row, no claim.
3. **Evidence classes stay separate:** owned (Search Console, npm, GitHub), provider estimates
   (OpenSEO, DataForSEO), observed pages and SERPs (dated), verbatim sourced quotes, and inference.
4. **Review happens on the PR.** Canon changes, positioning shifts, and page copy ship as a draft
   PR, and Saatvik reviews them there. Take the recommended default on open calls rather than
   asking, and note the defaults in the session, not the PR: the PR body describes only the change,
   because the repository is public. Merging and deploying need their own explicit grants.
5. **Comparison pages need primary sources and owner sign-off** (truth).

## Pipeline

| Stage       | Output                                                           | Owner                                  |
| ----------- | ---------------------------------------------------------------- | -------------------------------------- |
| 1. Research | ICP, customer words, competitors, demand, current-state audit    | this skill; `seo` for demand           |
| 2. Copy     | Canon changes, then text-only copy per page, in a draft PR       | `copywriting` (Sonnet subagents write) |
| 3. Design   | Layout in the docs site's visual system, verified in the browser | the implementing agent                 |
| 4. Ship     | Draft PRs from a `wt` worktree; checks green; review on the PR   | `pr` skill                             |
| 5. Measure  | Search Console, rank, and `pagegraph diff` against the baseline  | `seo`, `web-audit`                     |

Research that a later stage contradicts goes back to stage 1, not into a copy workaround.

## Routing

- Research and writing passes run on Sonnet subagents at medium effort with a stated scope and
  acceptance check; the coordinator reviews each result. High-volume docs-body passes stay on Sonnet.
- Live evidence (Search Console, npm, GitHub, SERPs) goes through Executor, read-only. Save research
  to `.scratchpad/research/` and plans to `.scratchpad/plans/`.
- Log any paid provider spend where the `seo` skill says.

## Output

Say what changed in the canon or registry, which facts came from source, npm, or a primary source,
which remain assumptions, and which approval is pending.
