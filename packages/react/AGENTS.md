# React package guide

`@domainkit/react` is a React 19 UI layer over a host-owned, browser-safe transport. It provides
complete flows and composable semantic parts; it does not own provider credentials, authenticated
routes, persistence, tenancy, or product verification policy.

## Public contract

- Keep `DomainKit.Root` and the exported flow/parts namespaces aligned with `src/index.ts` and the
  package manifest.
- Document the choice between model-free records, a complete `Domain.Flow`, and host-composed
  `Connection`/`Provisioning`/`Verification`/`Cleanup` lifecycles.
- Keep transport values serializable and host-authenticated. Explain the server-side digest,
  attempt, receipt, and verification boundaries in integration docs.
- Treat icons, provider marks, messages, and styling as host-customizable presentation concerns.
  Provider assets must use the single configured integrations source rather than provider-specific
  hidden fallbacks.
- Do not present uncommitted lifecycle-event work as part of the released npm artifact until it is
  published and read back from the packed package.

## Verification

For React changes run package tests, typecheck, build, and the relevant component/browser or packed
consumer checks. If docs or registry examples change, run the docs reference, registry, and strict
site checks too. Finish with `git diff --check` and inspect the rendered flow when UI behavior is
involved.
