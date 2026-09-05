# React package guide

`@domainkit/react` is a headless React 19 layer over a host-owned, browser-safe `Transport` from
`domainkit/client`. It supplies state, copy, and accessibility; the host application supplies the
markup. It does not own provider credentials, authenticated routes, persistence, tenancy, or
product verification policy.

## Public contract

- `src/index.ts` is the whole surface: the `Cleanup`, `Connect`, `Domain`, `DomainKit`, `Messages`,
  `Outcome`, `Provision`, `Records`, `Testing`, and `Verify` namespaces, plus `Event` and
  `Failure`. Keep it aligned with the package manifest and the packed artifact test.
- The package paints nothing. It exports no component, no stylesheet, no theme tokens, and no
  element vocabulary; an artifact test asserts the built bundle carries neither
  `data-domainkit-part` nor a `--domainkit-` variable. The styled composition is the shadcn
  registry in `apps/docs`, which writes the flow against the host's own kit.
- Every controller takes one options object and returns a named `Controller`. Build its `State`
  with `Data.taggedEnum`; never write a `{ _tag: "..." }` literal.
- `DomainKit.Root` takes the transport by value and keeps its identity for the mount. A change to
  the declared capability groups is the only thing that rebuilds it. It renders a context provider
  and no element.
- `Domain.useFlow` is the whole lifecycle for one domain: the four controllers, the pending plan,
  the readiness, and a `FlowState` a host reads to order its own offers beside DomainKit's. It
  plans as soon as the domain is attached with nothing applied. Attaching to a connection discovery
  already resolved belongs to `Connect.useController`, so a surface built on the controller alone
  gets it too.
- `readOnly` on `DomainKit.Root` or `Domain.useFlow` reports the state without the commands that
  change it, for authorization a transport cannot express. It is a fact on `FlowState.readOnly`, so
  a surface can say why rather than leaving a customer in front of an empty page. Observation stays
  available: checking DNS reads the world rather than changing the domain. A retry is a write too,
  so `retry` re-inspects instead of resending the last command.
- `Verify.useController` and `Domain.useFlow` pass the flow's requirements to `observe`, so a domain
  with no attachment verifies against what the host asked for rather than a receipt it has not
  earned yet. The requirement set is keyed by content, never array identity.
- An interactive connect returns the customer to the page they started from. `returnTo` on the
  connect controller and on `Domain.useFlow` names another destination; `null` defers to the server.
- Every user-visible string comes from `Messages.Catalog`, including a title and a description per
  `DomainKit.Error` reason. No tag, status literal, or reason name reaches a customer.
  `Outcome.useDescribe` binds the catalog the root holds.
- `Connect.describeMethods` arranges one provider's auth methods, and `Connect.rejectedField` names
  the one field a rejection was about, so a connect surface asks for one decision at a time without
  reading a descriptor itself.
- The package entry carries `"use client"`. A transport cannot cross an RSC boundary; hosts build
  one inside a client module.

## Effect boundary

`src/task.ts` is the only place the package leaves Effect. Controllers run transport calls through
`useRunner`, which interrupts the call in flight when a newer one starts or the component unmounts.
Nothing else calls `Effect.run*`.

## Verification

```sh
bun run --filter domainkit build            # @domainkit/react resolves types from domainkit/dist
bun run --filter @domainkit/react release:check
```

`release:check` runs typecheck, the hook tests over `Testing.transport`, the build, and the packed
Vite and Next consumers. The styled flow's browser spec lives in `apps/docs`, against the registry
block. Finish with `git diff --check`.
