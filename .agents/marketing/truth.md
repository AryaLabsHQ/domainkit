# Marketing truth

This file decides whether DomainKit may say something in public. [Positioning](positioning.md)
decides which true things to lead with, and [voice](voice.md) decides how they sound. Truth wins
every conflict among the three. Evidence for each claim lives in
[the proof registry](proof-registry.md); this file holds the rules, not the evidence.

Public means every surface a stranger can read: pages, titles, meta descriptions, OG cards, JSON-LD,
`llms.txt` and the `.md` mirrors, the READMEs, npm descriptions, registry item descriptions, GitHub
metadata, social posts, directory listings, and press copy. Metadata counts.

## What ships now

Public copy claims only what the latest published npm artifact does. Read the versions from npm at
ship time (`npm view domainkit version`, `npm view @domainkit/react version`,
`npm view @domainkit/capsuledb version`); never hard-code a version in copy that outlives the
release. Behaviour that exists only in a working tree, a branch, or a Scratchpad plan is not
claimable until it is released and read back from the packed or published artifact.

Claimable, tied to `packages/*/src/index.ts` and the entry points in each `package.json`:

- **Core (`domainkit`).** An Effect-native package root plus `domainkit/server` (a mountable
  `HttpApiGroup` for the host's API), `domainkit/client` (browser-safe transport with Promise
  adapters), and `domainkit/testing` (in-memory provider and transport).
- **Providers.** Cloudflare and Vercel are first-party provider integrations. A supported API is not
  a marketplace listing or a partnership.
- **React (`@domainkit/react`).** Headless hooks and flows over the host's transport. It renders no
  element. The styled path is the shadcn registry served from `domain-kit.dev/r/*.json`.
- **Persistence (`@domainkit/capsuledb`).** An optional Effect-native storage implementation.
- **The lifecycle.** Connect a provider, discover the zone, build an exact plan, review and approve
  its digest, apply, keep a receipt, observe provider and public-DNS evidence, and run separately
  approved receipt-bound cleanup.

Roadmap items may appear only as a labelled, undated "next" mention. Never promise a provider,
language SDK, or date.

## Host ownership

The host application owns credentials, persistence, identity, tenancy, callback routes, consent, and
audit policy. DomainKit ships interfaces for them, not custody.

- Never imply that DomainKit stores credentials, supplies authenticated routes, chooses tenant
  policy, or operates a hosted control plane.
- Never describe DomainKit as a DNS host, registrar, TLS or certificate provider, traffic proxy,
  universal provider abstraction, automatic DNS reconciler, hosted service, or successor to Domain
  Connect.
- A customer's grant is consent to an exact reviewed list of records. The account is the unit of
  consent: never describe a second prompt for an account already granted.

## Plans and safety

- Plans are additive and fail closed: matching records are `Noop`, missing records are `Create`, and
  incompatible state is `Conflict`. Conflicts are surfaced, never resolved silently.
- Apply authorization is bound to an exact plan digest. Cleanup is a separate operation bound to an
  apply receipt and separately approved.
- Say additive, reviewable, digest-bound, receipt-bound, and fail-closed.
- Never say atomic, transactional, race-free, rollback, rollback-safe, zero risk, or incapable of
  partial failure. Provider writes are not atomic, and receipts record what an attempt completed.
- Provider readback is not public propagation. Say "verified in public DNS" only for the public-DNS
  observation, not for a provider's own answer.

## Ease claims

Concrete beats adjectival. Say what the customer no longer does ("no copy-pasting DNS records",
"approve once", "see every record before anything changes"), not that setup is "frictionless" or
"seamless".

- Qualitative: copy-paste DNS instructions cause support tickets, and DomainKit removes the
  copy-paste step. Allowed.
- Percentages, ticket counts, time saved, and conversion lifts are prohibited unless a measured
  figure has a proof-registry row with its source and date.
- "Automatic" describes only a step that needs no host or user action. Connecting a provider and
  approving a plan need a person.

## Adoption and Samva

Samva may be named publicly. Approved wording: **"Samva sets up customer domains with DomainKit."**

- Samva's DomainKit setup is live in production; the evidence is in the proof registry.
- Say only what the registry supports: Samva writes TXT, MX, and CNAME records for a customer's
  sending domain on Cloudflare and Vercel zones after the customer approves the plan. DMARC is
  observed, not written.
- Do not call Samva a "design partner". Do not add a disclosure line about the shared maker.
- Do not mention Samva's use of Domain Connect on DomainKit surfaces.
- Any other consumer stays unnamed until it authorizes a public mention and a registry row records
  the evidence. A configured hostname, a passing test, or an internal fixture is never a production
  claim.
- Testimonials are verbatim and attributed with permission. Never invent a customer quote or a
  logo wall.

## Comparisons and competitors

- Every comparative claim needs a primary source (the vendor's pricing page, docs, or a dated
  filing) recorded in the proof registry with an observed date. Secondary summaries, competitor
  blog posts about a rival, and remembered anecdotes are not sources.
- Each comparison page needs owner sign-off before it goes public.
- Credit what competitors do well. Entri lists about 60 DNS providers with direct API login against DomainKit's two.
- Do not publish "Domain Connect is dead" (the templates repository is active and several providers
  list support) or "Entri costs thousands a month" (its public plan starts at $249 a month). Domain
  Connect is complementary, never a target.
- Boundary with TLS products: DomainKit writes and verifies DNS. TLS stays with Cloudflare for
  SaaS, Vercel, Caddy, or the customer's own proxy.

## Reach

Two built-in providers cover a technical slice of the web. Say so when reach matters; other domains
fall back to manual records with observation. Do not promise registrars or future providers.

## Offer

DomainKit is MIT-licensed open-source software distributed as npm packages and source code. There is
no paid plan, hosted service, support SLA, warranty, guarantee, or scarcity offer. Do not add
pricing language.

## Runtime and platform

Say portable ESM built on Web APIs, with engines and peer ranges from the package manifests. Do not
say "runs everywhere". React support is React 19.

## Invented proof

No invented customers, quotes, metrics, awards, press mentions, partner relationships, adoption
statistics, or usability findings. If a row is not in the proof registry, the claim waits.
