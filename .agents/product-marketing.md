# Product Marketing Context

_Last updated: 2026-08-31_ · _Current public stage: open-source packages at 0.3.1; hosted documentation is not live_

## Hard rules

- Lead with the problem DomainKit solves for a SaaS product, then substantiate it with the DNS
  safety model. Do not make Effect, React, or a provider API the product category.
- A public claim must describe the latest npm artifact or be held until the source that proves it is
  released. The working tree currently contains unreleased React lifecycle-event work.
- Never imply that DomainKit stores credentials, supplies authenticated routes, chooses tenant
  policy, or operates a hosted control plane. Those responsibilities belong to the host application.
- Never describe DomainKit as a DNS host, registrar, universal provider abstraction, automatic DNS
  reconciler, or successor to Domain Connect.
- Never turn a configured hostname, an implementation plan, a passing local test, or an internal
  consumer into a production-adoption claim.

## Public claim boundary

DomainKit may be described publicly as an open-source TypeScript toolkit for building domain setup
into SaaS products. It connects supported DNS providers, converts product-owned DNS requirements
into exact plans, binds authorization to the reviewed digest, records writes in receipts, observes
provider and public-DNS evidence, and exposes React flows over host-owned endpoints.

Public material may name Cloudflare and Vercel as first-party provider integrations. It may describe
the Effect-native package root, the secondary Promise facade, the testing utilities, React 19
support, provider conformance runner, and additive receipt-bound cleanup.

Public material must not claim that `domain-kit.dev` is available until DNS and the deployed routes
are verified. It must not describe uncommitted React lifecycle events as part of `0.3.1`, identify a
consumer without approval, promise future providers or language SDKs, or imply that DomainKit makes
provider writes transactional.

## Claim guardrails

- **Ease claims:** "Frictionless domain setup" and "one-click provider connection" are approved
  public language. Use "automatic" only for steps that require no host or user action.
- **Safety claims:** Say additive, reviewable, digest-bound, receipt-bound, and fail-closed. Do not
  say atomic, race-free, rollback-safe, or incapable of partial failure.
- **Provider claims:** Name only capabilities exercised by current source and tests. A supported API
  does not imply a marketplace listing or provider partnership.
- **Runtime claims:** Say portable ESM built on Web APIs with the engines and peer versions from the
  package manifests. Do not use "runs everywhere."
- **Adoption claims:** Repository use, test fixtures, and private consumer validation are evidence
  for design decisions, not authorization to name customers or claim production adoption.

## Product overview and category

**Category:** domain setup infrastructure for SaaS applications.

**Positioning:** DomainKit helps SaaS teams build provider-connected domain setup into their own
product. It turns DNS requirements into exact, reviewable changes and applies only an authorized
plan while credentials, persistence, policy, and user experience remain under host control.

**Proof mechanism:** deterministic `create` / `noop` / `conflict` planning, digest-bound approval,
stale-plan detection, partial receipts, separately authorized cleanup, provider/public-DNS
observation, and a browser-safe application transport.

## Audience, ICP, personas, and anti-personas

### Primary ICP

A TypeScript SaaS team whose customers must connect domains for email, custom hostnames, tracking,
verification, publishing, or another product-owned DNS requirement. The primary reader is the
backend or full-stack engineer responsible for security, persistence, provider integration, and the
customer setup experience.

### Secondary personas

- Frontend and design-system engineers adopting `@domainkit/react` as complete flows or semantic
  parts.
- Effect application developers who want typed failures, explicit Layers, and lifecycle ownership.
- Provider-adapter authors implementing the narrow DNS contract and running conformance tests.

### Anti-personas

- A domain owner looking for a hosted registrar dashboard or command-line DNS manager.
- A browser-only application that cannot keep provider credentials on a trusted server.
- A team seeking a library to overwrite arbitrary DNS state or silently resolve conflicts.
- A team expecting DomainKit to provide credential custody, application tenancy, or an audit system.

## Jobs, problems, switching forces, and objections

### Jobs

- Turn application DNS requirements into a customer-reviewable setup flow.
- Connect a supported provider without leaking credentials into browser code.
- Reuse a valid provider authorization when the same owner adds another domain.
- Distinguish missing records, exact matches, incompatible state, propagation delay, and provider
  failure.
- Remove only records proven to belong to an earlier apply attempt.
- Adopt a complete React flow or integrate the lifecycle into an existing product screen.

### Switching forces

- **Push:** manual copy/paste setup is error-prone; direct provider integrations couple product code
  to provider-specific accounts, scopes, errors, and record APIs.
- **Pull:** one portable lifecycle with exact review, typed outcomes, reusable authorization, and
  composable UI.
- **Habit:** existing manual instructions and bespoke provider code already work for common cases.
- **Anxiety:** provider credentials are high authority; DNS changes can disrupt production; a new
  abstraction may hide provider-specific behavior or create unsafe cleanup expectations.

### Objection handling

- **"Why not call the provider API directly?"** Direct APIs still need a host-owned security model.
  DomainKit supplies the shared planning, authorization, receipt, verification, and cleanup
  semantics without taking over host infrastructure.
- **"Does this manage my users or secrets?"** No. The host owns identity, tenancy, storage,
  encryption, consent, routes, and audit policy.
- **"Will it fix DNS conflicts automatically?"** No. Conflicts are surfaced and writes fail closed.
- **"Must my application use Effect everywhere?"** No. Effect is canonical internally; an explicit
  Promise facade is available at foreign runtime boundaries.

## Competitive landscape and differentiation

DomainKit sits between manual DNS instructions and bespoke provider API integrations. Its public
differentiation is the portable safety lifecycle plus host ownership, not a claim that other
protocols or integration vendors are technically unsound. Comparative claims require a fresh,
primary-source review before publication.

## Customer language, words to avoid, and glossary

### Prefer

- domain setup
- frictionless domain setup
- one-click provider connection
- connect a DNS provider
- review exact DNS changes
- apply the approved plan
- host-owned credentials and policy
- provider authorization
- domain grant
- receipt-bound cleanup
- public DNS observation
- complete flows and composable parts

### Avoid

- magic DNS
- fully automatic
- zero risk
- atomic DNS transaction
- rollback
- credential management platform
- provider partnership
- Domain Connect replacement or successor

### Glossary

- **Requirement:** DNS state a product needs, including ownership, purpose, and conflict policy.
- **Plan:** a provider/zone snapshot containing exact operations and a deterministic digest.
- **Authorization:** approval for a specific plan digest and operation set.
- **Receipt:** durable evidence of writes an apply attempt actually completed.
- **Provider authorization:** an account-scoped credential and non-secret provider context.
- **Domain grant:** the host-owner scope in which an authorization may be used.
- **Observation:** tagged provider or public-DNS evidence; not the host product's complete readiness
  state.

## Brand voice and copy rules

- Write for a competent product engineer. Be direct, concrete, and calm.
- State the user outcome first and the implementation mechanism second.
- Prefer exact lifecycle nouns and verbs over broad claims of simplicity.
- Put prerequisites, security boundaries, expected output, and failure behavior near the action.
- Keep tutorials choice-free, how-to guides goal-oriented, reference neutral, and explanations
  bounded around a clear "why" question.

## Evidence ledger

| Claim                                                                              | Evidence                                                               | Source                                                                                             | Observed date | Allowed surface                                | Confidence | Owner                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------- | ---------- | ------------------------ |
| `domainkit` and `@domainkit/react` latest npm versions are `0.3.1`                 | npm registry readback                                                  | `npm view domainkit`; `npm view @domainkit/react`                                                  | 2026-08-31    | Public web and package docs                    | high       | Maintainer               |
| DomainKit plans missing, exact, and incompatible DNS as create, noop, and conflict | Source, schemas, tracer tests                                          | `packages/domainkit/src/plan/`; `packages/domainkit/tests/tracer/`                                 | 2026-08-31    | All public technical surfaces                  | high       | Core package maintainer  |
| Apply authorization is bound to an exact plan digest                               | Source, schemas, tests                                                 | `packages/domainkit/src/plan/types.ts`; `packages/domainkit/src/plan/plan.ts`                      | 2026-08-31    | All public technical surfaces                  | high       | Core package maintainer  |
| Safe cleanup is separately planned and bound to a prior apply receipt              | Source and tests                                                       | `packages/domainkit/src/plan/deletion.ts`; `packages/domainkit/tests/tracer/plan-apply.test.ts`    | 2026-08-31    | All public technical surfaces                  | high       | Core package maintainer  |
| Cloudflare and Vercel are first-party provider integrations                        | Public exports and provider tests                                      | `packages/domainkit/src/index.ts`; `packages/domainkit/src/providers/`                             | 2026-08-31    | Public web and technical docs                  | high       | Provider maintainers     |
| Provider credentials and durable lifecycle storage remain host-owned               | Accepted architecture decision and interfaces                          | `packages/domainkit/docs/adr/0004-host-owned-credentials.md`                                       | 2026-08-31    | All public surfaces                            | high       | Core package maintainer  |
| The package root is Effect-native and `domainkit/promise` is secondary             | Package exports, artifact tests, accepted ADR                          | `packages/domainkit/package.json`; `packages/domainkit/docs/adr/0006-effect-first-package-root.md` | 2026-08-31    | Public technical surfaces                      | high       | Core package maintainer  |
| `@domainkit/react` provides React 19 flows over a host-owned transport             | Manifest, source, artifact tests                                       | `packages/react/package.json`; `packages/react/src/`                                               | 2026-08-31    | Public technical surfaces                      | high       | React package maintainer |
| React lifecycle events are available in the current working tree                   | Uncommitted source and tests                                           | `packages/react/src/lifecycle.ts`; `packages/react/src/domain-kit.tsx`                             | 2026-08-31    | Internal and unreleased documentation only     | medium     | React package maintainer |
| DomainKit reduces customer setup friction                                          | Product intent and implemented flow; no current usability study        | Current landing page and React workshop                                                            | 2026-08-31    | Directional headline only; no quantified claim | medium     | Product owner            |
| `domain-kit.dev` hosts public documentation                                        | DNS lookup currently fails                                             | `curl https://domain-kit.dev/`                                                                     | 2026-08-31    | Prohibited until live verification             | high       | Documentation owner      |
| A named product uses DomainKit in production                                       | No public authorization or live acceptance evidence in this repository | Evidence gap                                                                                       | 2026-08-31    | Prohibited                                     | low        | Product owner            |

## Offer truth

DomainKit is MIT-licensed open-source software distributed as npm packages and source code. There is
no documented paid plan, hosted service, support SLA, warranty, guarantee, or scarcity offer.

## Distribution truth

| Channel            | Status                                  | Destination                                 | Allowed claim                                                  |
| ------------------ | --------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| npm core package   | active                                  | `domainkit@0.3.1`                           | Latest public core package                                     |
| npm React package  | active                                  | `@domainkit/react@0.3.1`                    | Latest public React package                                    |
| GitHub             | active                                  | `AryaLabsHQ/domainkit`                      | Public source repository                                       |
| Documentation site | unavailable                             | `domain-kit.dev` does not currently resolve | Do not direct users there until verified                       |
| Shadcn registry    | source present, public route unverified | `apps/docs/registry.json`                   | Describe repository source only until hosted route is verified |

## PR truth

No press description, customer quote, partner relationship, adoption statistic, founder bio, or
press contact is approved by this document. The repository and npm package facts above are the only
public distribution facts it authorizes.

## Goals and conversion actions

- Help an evaluating engineer understand the product boundary in under five minutes.
- Help a new user create and inspect a safe in-memory plan without credentials.
- Help an integrating team identify every host-owned persistence and security responsibility before
  connecting a live provider.
- Primary conversion actions while the docs host is unavailable: inspect the GitHub repository and
  install the npm package.

## Evidence gaps and re-verification owners

- **Documentation deployment:** documentation owner must verify DNS, routes, generated artifacts,
  and public pages before changing distribution status.
- **React lifecycle events:** React maintainer must release and read back the packed/npm artifact
  before they become a published-version claim.
- **Customer outcomes:** product owner must approve a named case study or usability evidence before
  publishing adoption or ease claims.
- **Provider capability changes:** provider maintainers must re-run conformance and live profiles
  before expanding provider claims.
- **Comparative positioning:** product owner must approve current primary-source research before a
  competitor or protocol comparison appears on a public page.

## Internal notes for agents using this file

The host-ownership and plan/receipt safety boundaries are load-bearing. Do not delete them during a
copy-shortening pass. Do not promote working-tree features, Scratchpad plans, consumer details, or a
configured hostname into public truth. Re-read package exports, artifact tests, and provider tests
before changing technical claims.
