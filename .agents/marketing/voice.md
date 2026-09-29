# Marketing voice

How DomainKit sounds. [Truth](truth.md) decides what may be said and wins on conflict;
[positioning](positioning.md) decides which story to tell. This file gives principles, the
customer's own words, and the style rules that earn their place.

## Principles

1. **Pass the grunt test.** In five seconds a stranger knows what it is, how their day improves, and
   what to do next. Clever lines that need a second read fail.
2. **Use the customer's words.** "Custom domain", "connect your domain", "verify", "add a CNAME".
   Not "domain attachment", "provider authorization", or "public DNS observation" in a headline.
3. **Name the problem, then the outcome, then the proof.** The villain is the copy-paste DNS
   instructions page. Show what changes, then the mechanism (plan, digest, receipt) that makes it
   true. Developers read proof: show real code early.
4. **Show, do not label.** "Easy", "frictionless", and "secure" mean nothing alone. Show the exact
   records, the single approval, the record counts, the verified state.
5. **Sound like a builder talking to a builder.** Short sentences, active voice, concrete nouns,
   verbs over nouns. Direct and calm, willing to take a side, never cute.
6. **Be honest about the shelf.** Say what rivals do well and what DomainKit does not do (two
   providers, no TLS, no hosted service). Win on specifics, not superlatives.
7. **A why-page states rationale in present tense.** A "why DomainKit" explainer says what the
   product is for and how it decides, not how it came to be. The docs no-history rule still applies.

## Customer words

Phrases from builders and end customers, collected from public threads. Borrow the language; quote
a person only with the source. Vendor-authored posts are marked (V).

| Phrase                                                                                                   | Source, date                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| "If you offer custom domains in your SaaS, you will get this ticket." (V)                                | [domainee.dev](https://domainee.dev/blog/debug-customer-custom-domain-runbook), 2026-06-01                              |
| "I was building custom domain support for 4th project, and I really got tired of it."                    | [r/SaaS](https://www.reddit.com/r/SaaS/comments/1sb171i/i_got_tired_of_building_custom_domain_support_for/), 2026-04-29 |
| "hand holding each customer to get the custom domain working was the pain point."                        | [Show HN comment](https://whnex.com/items/21527004), n.d.                                                               |
| "Setting up DNS records is one of the most common drop-off points in any SaaS onboarding flow." (V)      | [developers.entri.com](https://developers.entri.com/connect/overview), n.d.                                             |
| "Two SPF records. The most common and the most damaging." (V)                                            | [trekmail.net](https://trekmail.net/blog/dns-setup), 2026-07-27                                                         |
| "The creator who doesn't know what a CNAME record is and shouldn't have to."                             | [jannis.io](https://www.jannis.io/open-means-open-or-it-means-nothing/), 2026-02-24                                     |
| "Your user stares at a wall of DNS records ... and either gives up ... or floods your support team." (V) | [zonify.dev](https://www.zonify.dev/blog/email-marketing-dns-authentication), n.d.                                      |
| "I'm not entirely sure who the website host is"                                                          | [r/webhosting](https://www.reddit.com/r/webhosting/comments/1lglar6/unable_to_edit_dns_settings/), 2025-06-21           |

Builders say "custom domain", "CNAME", "point their DNS", "onboarding", "hand holding", "tickets",
and "verify". Keep the canon nouns (plan, digest, receipt, observation) for reference pages and
proof sections.

## Headlines

- The homepage title and hero carry the category noun ("custom domains for SaaS") and the outcome.
- Every other page's H1 is its outcome in customer words, with the page's search term in the H1 or
  the line under it.
- Every key page opens with the quotable definition sentence or a faithful variant (positioning).
- Section headings are outcomes ("Your customer sees every record first"), never schema names.
- No slogan stamped across pages, no hero that states a label and hides the outcome in small print.

## Style rules

- **Em dashes:** none in prose.
- **Titles and descriptions:** rendered titles run 60 columns or fewer; meta descriptions run 110 to
  160 characters. `bun run audit --strict` in `apps/docs` enforces both, plus at least one inbound
  body link per page.
- **CTAs:** the primary action goes to the Quickstart (`bun add domainkit`). Secondary: GitHub.
  Tertiary: npm. A transitional CTA may point at the live flow on the page.
- **Numbers over adjectives:** "25 endpoints", "two providers", "one approval". Read counts from
  source, never from memory.
- **Names:** `DomainKit` in prose; `domainkit`, `@domainkit/react`, and `@domainkit/capsuledb` for
  packages. Lifecycle nouns are exact: plan, digest, authorization, receipt, observation.
- **Code samples** are slices of files in `examples/` or `packages/domainkit/examples`, never
  hand-written (see `apps/docs/AGENTS.md`).
- **Words to avoid:** frictionless, seamless, robust, powerful, best-in-class, magic, "just works"
  without the specifics behind it, "modern" as a value, fully automatic, zero risk, atomic,
  transaction, rollback, credential management platform, provider partnership, Domain Connect
  replacement or successor, "design partner". Truth owns the banned claims.

## Who writes what

- `copywriting` owns marketing pages: sections, headlines, CTAs, metadata, comparison pages, and
  their edit pass.
- `documentation-authoring` owns docs bodies; it defers to `truth.md` for claims.
- The global `writing` skill owns long-form prose such as posts and changelog entries.
- All follow this file. The `product-marketing` skill sequences research, writing, and approval.
