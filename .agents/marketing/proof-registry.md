# Proof registry

The evidence behind every public claim. [Truth](truth.md) holds the rules; this file holds the
evidence. A claim with no row waits. Add a row before the sentence ships, and re-verify a row before
reusing it after its observed date has aged out (pricing and provider lists change).

Versions are not recorded here. Read them from npm at ship time (`npm view <package> version`).

Columns: claim, evidence, source, observed date, allowed surface, confidence, owner.

## Product claims

| Claim                                                                              | Evidence                                         | Source                                                                                          | Observed   | Allowed surface               | Confidence | Owner                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------- | ----------------------------- | ---------- | ------------------------ |
| DomainKit plans missing, exact, and incompatible DNS as create, noop, and conflict | Source, schemas, tracer tests                    | `packages/domainkit/src/plan/`; `packages/domainkit/tests/tracer/`                              | 2026-08-31 | All public technical surfaces | high       | Core package maintainer  |
| Apply authorization is bound to an exact plan digest                               | Source, schemas, tests                           | `packages/domainkit/src/plan/types.ts`; `packages/domainkit/src/plan/plan.ts`                   | 2026-08-31 | All public technical surfaces | high       | Core package maintainer  |
| Safe cleanup is separately planned and bound to a prior apply receipt              | Source and tests                                 | `packages/domainkit/src/plan/deletion.ts`; `packages/domainkit/tests/tracer/plan-apply.test.ts` | 2026-08-31 | All public technical surfaces | high       | Core package maintainer  |
| Cloudflare and Vercel are first-party provider integrations                        | Public exports and provider tests                | `packages/domainkit/src/index.ts`; `packages/domainkit/src/providers/`                          | 2026-08-31 | Public web and technical docs | high       | Provider maintainers     |
| Provider credentials and durable lifecycle storage remain host-owned               | Architecture decision and interfaces             | `packages/domainkit/docs/adr/0004-host-owned-credentials.md`                                    | 2026-08-31 | All public surfaces           | high       | Core package maintainer  |
| `Server.group` mounts one route group with twenty-five endpoints                   | Source                                           | `packages/domainkit/src/Server.ts`                                                              | 2026-09-29 | Public web and technical docs | high       | Core package maintainer  |
| `@domainkit/react` provides headless React 19 flows over a host-owned transport    | Manifest, source, artifact tests                 | `packages/react/package.json`; `packages/react/src/`                                            | 2026-09-29 | Public technical surfaces     | high       | React package maintainer |
| The registry ships styled blocks installable with shadcn                           | Registry manifest and scratch-install check      | `apps/docs/registry.json`; `bun run registry:check`                                             | 2026-09-29 | Public web and package docs   | high       | Documentation owner      |
| Copy-paste DNS instructions cause support tickets; DomainKit removes the copy step | Public builder threads and vendor docs; no study | [Customer words](voice.md#customer-words)                                                       | 2026-09-29 | Qualitative statements only   | medium     | Product owner            |
| DomainKit reduces customer setup friction by a measured amount                     | None                                             | Evidence gap                                                                                    | 2026-09-29 | Prohibited                    | none       | Product owner            |

## Adoption

| Claim                                                                                                                                             | Evidence                                                                                                                                                                                                                                                                                               | Source                                                                                                     | Observed   | Allowed surface                                                              | Confidence | Owner         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- | ---------- | ------------- |
| Samva sets up customer domains with DomainKit                                                                                                     | Samva's DomainKit setup is live in production, confirmed by Saatvik Arya on 2026-09-29. Samva `main` pins `domainkit`, `@domainkit/react`, and `@domainkit/capsuledb`, composes the Cloudflare and Vercel providers, and mounts `domainkit/server`; the source and end-to-end scenarios are on `main`. | Maintainer confirmation; Samva `apps/api/src/email/provisioning/domainkit.ts` at `main`, 2026-09-29        | 2026-09-29 | Public web (approved wording, name, and logo); no disclosure line            | high       | Product owner |
| Samva writes TXT (SPF and verification), MX (mail-from and receiving), and CNAME (DKIM and tracking) records after the customer approves the plan | Samva `requirement()` mapping and records card                                                                                                                                                                                                                                                         | Samva `apps/api/src/email/provisioning/domainkit.ts`; `apps/web/src/email/domain-provisioning-section.tsx` | 2026-09-29 | Case study; Cloudflare and Vercel zones only; DMARC is observed, not written | high       | Product owner |
| A measured Samva outcome (tickets, time to verify)                                                                                                | None yet                                                                                                                                                                                                                                                                                               | Evidence gap                                                                                               | 2026-09-29 | Prohibited until measured and recorded                                       | none       | Product owner |
| Any other named consumer                                                                                                                          | None                                                                                                                                                                                                                                                                                                   | Evidence gap                                                                                               | 2026-09-29 | Prohibited                                                                   | none       | Product owner |

## Comparisons

Comparison pages need owner sign-off and a primary source per claim.

| Claim                                                                                               | Evidence                                               | Source                                                | Observed   | Allowed surface        | Confidence | Owner         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- | ---------- | ---------------------- | ---------- | ------------- |
| Entri's public plan starts at $249 a month for 600 domains a year                                   | Vendor pricing page; higher tiers are by quote         | `https://www.entri.com/plans`                         | 2026-09-29 | Comparison page, dated | high       | Product owner |
| Entri's docs list about 60 DNS providers with direct API login                                      | Vendor provider list                                   | `https://developers.entri.com/connect/provider-list`  | 2026-09-29 | Comparison page, dated | high       | Product owner |
| Entri costs thousands of dollars a month                                                            | Fails the primary source                               | `https://www.entri.com/plans`                         | 2026-09-29 | Prohibited             | none       | Product owner |
| Domain Connect is dead                                                                              | Fails the primary source; the templates repo is active | `https://github.com/Domain-Connect/Templates`         | 2026-09-29 | Prohibited             | none       | Product owner |
| Domain Connect onboarding is per provider: a merged template must be onboarded by each DNS provider | Protocol documentation                                 | Domain Connect specification and templates repository | 2026-09-29 | Comparison page, dated | medium     | Product owner |
| Cloudflare serves DNS for 18.5% of all websites and 35.9% of the top million                        | Third-party survey                                     | W3Techs, September 2026                               | 2026-09-29 | Reach caveats, dated   | medium     | Product owner |

## Distribution

| Channel               | Status | Destination                       | Allowed claim                                          |
| --------------------- | ------ | --------------------------------- | ------------------------------------------------------ |
| npm core package      | active | `domainkit`                       | Latest public core package (read version at ship time) |
| npm React package     | active | `@domainkit/react`                | Latest public React package                            |
| npm CapsuleDB package | active | `@domainkit/capsuledb`            | Optional Effect-native persistence package             |
| GitHub                | active | `AryaLabsHQ/domainkit`            | Public source repository, MIT                          |
| Documentation site    | live   | `https://domain-kit.dev`          | Hosted documentation and generated artifacts           |
| shadcn registry       | live   | `https://domain-kit.dev/r/*.json` | Public registry components                             |

## Re-verification

- Documentation deployment: verify source, built artifact, and provider state separately before
  changing distribution status.
- Provider capability changes: re-run conformance and live profiles before expanding provider claims.
- Comparison rows: re-read the vendor's page on the day a comparison page ships.
- Customer outcomes: measure before publishing any figure.
