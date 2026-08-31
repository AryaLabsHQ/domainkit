# Core package guide

The package root is the canonical Effect API. Public entry points are `domainkit`,
`domainkit/promise`, `domainkit/server`, and `domainkit/testing`, as declared in `package.json`.
The source entry files and packed artifact tests are authoritative; internal module paths and
superseded ADR examples are not public API.

## Public contract

- Keep the additive, fail-closed plan model (`create`, `noop`, `conflict`) and digest-bound
  authorization intact.
- Cleanup must remain separately authorized and receipt-bound.
- `domainkit/promise` delegates to the same implementation at Promise-oriented boundaries; do not
  create a second lifecycle with different semantics.
- Provider adapters implement the narrow DNS contract and preserve opaque records. Cloudflare and
  Vercel capabilities must be supported by source and tests before they appear in public docs.
- Credentials and durable lifecycle state are host-owned. Never move secrets into browser-safe
  transport or public examples.

## Documentation and verification

When exports change, update the owning `apps/docs/content/reference` inventory and run the docs
reference checker. Update READMEs and packed-consumer tests for published-surface changes. Run the
package's Bun test, typecheck, build, and relevant provider/conformance suites; finish with
`git diff --check`.
