# Marketing positioning

Who DomainKit is for, the story it tells them, the words it competes on, and the pages that carry
them. [Truth](truth.md) decides what may be claimed and wins on conflict; [voice](voice.md) decides
how it sounds.

## Category

**Internal category:** domain setup infrastructure for SaaS. Use it in rules and planning, never as
a headline.

**Public headline vocabulary:** "Custom domains for SaaS". It is the term customers and builders
search and say, and the root that already ranks. "Domain setup infrastructure" stays out of
headlines.

**Definition (the sentence an AI overview can quote).** Open every key page with it or a faithful
variant:

> DomainKit is an open-source TypeScript library that sets up a customer's DNS records through their
> own Cloudflare or Vercel account: it plans the exact changes, applies only what the customer
> approved, and verifies them in public DNS.

Effect, React, and provider APIs are delivery layers, not the category.

## Who it is for

**Primary: TypeScript SaaS teams whose customers must add DNS records before the product works,
led by email-sending products** (transactional, inbound, agent, and white-label email). Email leads
because records often already exist (SPF), which is where a `Create`, `Noop`, or `Conflict` plan
earns its keep; TLS is not part of the job, so DomainKit's boundary costs nothing; and Samva is an
email API.

- Trigger: a customer pastes a domain into the form, follows the DNS instructions, and writes in
  that it does not work.
- Job: let the customer add their domain inside the product and have it work the first time,
  without hand-holding each one.

**Second: multi-tenant SaaS that serves customer hostnames.** The loudest pain in customer language.
Copy for it says DomainKit writes the DNS; **TLS stays with Cloudflare for SaaS, Vercel, or Caddy.**

**Two readers on every surface.** The evaluator (the engineer) needs the safety model and who owns
which responsibility. The end customer (the domain owner) needs "you'll see every record before
anything changes" and a button labelled Verify.

**Also served:** Effect application developers who want typed failures and explicit Layers;
provider-adapter authors implementing the narrow DNS contract and running conformance.

### Anti-personas

- AI app builders and site builders whose end customers are consumers, and who already use a hosted
  widget. Not the lead.
- Status pages and docs hosts. Not the lead.
- A domain owner looking for a hosted registrar dashboard or command-line DNS manager.
- A browser-only application that cannot keep provider credentials on a trusted server.
- A team seeking a library to overwrite arbitrary DNS state or silently resolve conflicts.
- A team expecting credential custody, tenancy, an audit system, TLS, or an SLA from DomainKit.

## The story (StoryBrand)

- **Hero:** an engineer on a SaaS team whose customers have to add DNS records before the product
  works.
- **Wants:** customers add their domain inside the product, and it works the first time.
- **Villain (customer-facing):** the DNS instructions page. Customers copy three or four fields per
  record into a registrar they barely know, get one wrong, and open a ticket. This is the only
  villain on the homepage and docs.
- **Villain (builder-facing, comparison pages only):** onboarding each DNS provider separately, or
  waiting on a registrar's permission. Frame it as mechanism, never as a target or a successor.
- **Internal problem:** hand-holding each customer through DNS, and the worry of writing to a
  customer's production zone.
- **Philosophical:** the customer's permission should be the only permission you need.
- **Guide:** DomainKit. Open source, runs in your app. It shows the customer the exact records before
  writing any of them, keeps a receipt of what it applied, and sets up customer domains for Samva in
  production.
- **Plan:** 1. Declare the records your app needs. 2. The customer connects Cloudflare or Vercel once
  and approves the exact plan. 3. DomainKit applies what they approved and checks public DNS until
  the records resolve.
- **Stakes:** broken SPF and DKIM, overwritten records, lost signups, a support queue full of DNS
  tickets.
- **Success:** the customer approves once, sees exactly what changes, and the domain is verified
  without leaving your app.
- **CTA:** direct, Quickstart (`bun add domainkit`). Transitional, try the live flow on the page and
  star the repository.

## Homepage

- **H1:** Custom domains for your SaaS, without the DNS instructions.
- **Title:** Custom domains for SaaS: DNS setup in your app | DomainKit
- **Subhead:** Your customer connects Cloudflare or Vercel once, reviews the exact records, and
  approves. DomainKit applies them and verifies they resolve.
- **Proof chip:** the Samva logo with "Samva sets up customer domains with DomainKit", linking to the
  case study.

## Proof themes

Lead with the customer outcome, then substantiate with one of these. Never lead with the
technology.

1. Review before write: the exact plan, `Create` / `Noop` / `Conflict`.
2. Consent is a digest: approval binds to the plan that was reviewed.
3. Your app keeps custody: credentials, storage, tenancy, and audit are the host's.
4. Receipts and receipt-bound cleanup.
5. Verification with evidence: provider readback and public-DNS observation.
6. One grant per account, reused across domains.
7. The registry: real UI you own, over the host's transport.

## Comparison frame

DomainKit sits between hand-written DNS instructions and hosted or per-provider integrations. The
axes are mechanism, control, safety semantics, and layer. None claims a rival is unsound.

1. **Mechanism:** per-provider template onboarding (Domain Connect) versus a per-user grant to a
   provider API (DomainKit) versus a hosted modal (Entri).
2. **Control:** a hosted vendor versus a library in your stack.
3. **Safety semantics:** plan digest, conflict-not-overwrite, receipts, receipt-bound cleanup.
4. **Layer:** DomainKit writes DNS. Cloudflare for SaaS, Vercel, Caddy, and proxies handle TLS and
   traffic.

Never "successor" or "replacement" for Domain Connect. Credit rivals honestly: Entri's provider
breadth, its hosted modal and vendor support.

### Page list

| Page                               | Job                                                                | Priority |
| ---------------------------------- | ------------------------------------------------------------------ | -------- |
| `/`                                | Homepage per the story above                                       | P1       |
| `/customers/samva`                 | Case study with testimonial and a followed link to samva.dev       | P1       |
| `/compare/entri`                   | A library in your app versus a hosted modal                        | P1       |
| `/compare/cloudflare-for-saas`     | "Works with": Cloudflare issues the cert, DomainKit writes the DNS | P1       |
| `/guides/custom-domain-onboarding` | Code-first guide for "saas custom domain setup"                    | P1       |
| `/docs/providers/cloudflare`       | Retitle for Cloudflare for SaaS vocabulary                         | P1       |
| `/compare/domain-connect`          | Per-provider onboarding versus user grants, and how to offer both  | P2       |
| `/compare/manual-dns`              | Why copy-paste instructions break                                  | P2       |
| `/guides/email-domain-setup`       | SPF, DKIM, and return-path records for customers' sending domains  | P2       |
| Docs pages                         | Definition-first intros, customer vocabulary; URLs unchanged       | P2       |

Every comparison page carries a dated evidence footer, links each claim to the vendor's own page,
and needs owner sign-off (truth).

## Objections

| Objection                                        | Honest response                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Does it do the certificate or custom hostname?" | No. Pair it with Cloudflare for SaaS, Vercel, or Caddy. DomainKit writes and verifies the DNS.                                                                                                                                                                                                                     |
| "Entri already does this."                       | Entri is hosted and broader (about 60 providers). DomainKit is a library in your app: credentials in your database, receipts you own, two providers today.                                                                                                                                                         |
| "Only Cloudflare and Vercel?"                    | Yes today; everything else falls back to manual records with observation.                                                                                                                                                                                                                                          |
| "Why would my customer grant a DNS token?"       | Consent is to an exact reviewed list of records. Plans are additive; cleanup is separately approved and receipt-bound.                                                                                                                                                                                             |
| "What if their SPF already exists?"              | The same value is `Noop`. A different existing SPF record needs explicit handling before apply: TXT defaults to `append`, so the plan would `Create` a second `v=spf1` record and break SPF. The `exclusive` policy turns any other TXT at that name into a `Conflict` instead. DomainKit never merges SPF values. |
| "I can call the Cloudflare API myself."          | True. The shared lifecycle (digest-bound approval, stale-plan detection, receipts, cleanup, observation) is the part every team rebuilds.                                                                                                                                                                          |
| "Where does the token live? Who is liable?"      | The host: storage, encryption, tenancy, audit. DomainKit ships interfaces, not custody.                                                                                                                                                                                                                            |
| "Will it fix DNS conflicts automatically?"       | No. Conflicts are surfaced and writes fail closed.                                                                                                                                                                                                                                                                 |
| "Must my application use Effect everywhere?"     | No. Effect is canonical in the core, and `domainkit/client` offers Promise adapters at the browser boundary.                                                                                                                                                                                                       |
| "Is it production-proven?"                       | Samva sets up customer domains with DomainKit in production (proof registry). Say no more than the registry supports.                                                                                                                                                                                              |

## Words and titles

| Use                                                         | Not                                         |
| ----------------------------------------------------------- | ------------------------------------------- |
| custom domain, connect your domain, verify, DNS records     | frictionless, seamless                      |
| Custom domains for SaaS (root of the homepage title and H1) | domain setup infrastructure (internal only) |
| plan, digest, approve, receipt, observation                 | transaction, rollback, atomic               |
| connect Cloudflare or Vercel                                | universal DNS provider support              |
| your customer's own Cloudflare or Vercel account            | a hosted DomainKit account                  |

Title pattern: `<Outcome or topic> | DomainKit` for the homepage and marketing pages. Docs pages keep
the `<title> - DomainKit` suffix Blume adds. Titles run 60 columns or fewer (voice).

Target terms: "custom domains for saas" (home), "cloudflare for saas" (Cloudflare comparison and
provider page), "entri alternative" (`/compare/entri`), "saas custom domain setup" (guide). "Domain
Connect" appears on its comparison page only, never in the hero. Check demand and the live SERP
before shipping any new title term.

## Launch horizons

Now: the released packages. Next: a labelled, undated mention only (truth). Later: private.
