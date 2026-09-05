---
packages:
  "@domainkit/react": major
---

## Headless hooks, and the registry as the styled path

`@domainkit/react` keeps behaviour and loses paint. `usePart`, `leafPart`, `PartProps`, every
component, the `data-domainkit-part` vocabulary, `styles.css`, `Theme`, `icons`, the `marks` map,
and `Provider.Mark` are gone, along with `DomainKit.Root`'s `theme`, `marks`, `icons`,
`colorScheme`, and `portalContainer` props and the `./styles.css` export. The package no longer
depends on `@base-ui/react`.

`DomainKit.Root` is a context provider that renders no element, taking `transport`, `messages`,
`navigate`, `onEvent`, `readOnly`, and `revision`. `Domain.useFlow({ domain, requirements, connect,
onApplied, onCleaned, returnTo, readOnly })` replaces `Domain.Flow` and returns `state`,
`connection`, `provisioning`, `cleanup`, `verification`, `plan`, `readiness`, `capabilities`,
`requirements`, and `invitation`. Read-only is a fact on `FlowState.readOnly`, so a surface says who
may connect rather than rendering nothing.

`Connect` gains `describeMethods`, `rejectedField`, `attempted`, `reusableConnections`, `reconnect`,
`providerOf`, `displayName`, and `useDomainField`, which carries the combobox semantics as
`inputProps`, `listboxProps`, and `optionProps`. `Outcome` is `describe(error, catalog)` and
`useDescribe()`. `Provision` and `Cleanup` export `pendingPlan` and `planOf`; `Verify` exports
`valuesOf`; `Records` keeps `statusOf`, `useCopy`, `toZoneFile`, and `downloadZoneFile`.

The styled composition is the DomainKit shadcn registry: `domain-flow` over `provider-row`,
`records-table`, `plan-action`, `connect-dialog`, `disconnect-dialog`, `domain-field`, and
`outcome`, written against the host's own kit on the Base UI idiom.
