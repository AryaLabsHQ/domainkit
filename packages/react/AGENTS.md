# React package guide

`@domainkit/react` is a React 19 UI layer over a host-owned, browser-safe `Transport` from
`domainkit/client`. It does not own provider credentials, authenticated routes, persistence,
tenancy, or product verification policy.

## Public contract

- `src/index.ts` is the whole surface: the `Cleanup`, `Connect`, `Domain`, `DomainKit`, `Messages`,
  `Operations`, `Provider`, `Provision`, `Records`, `Testing`, `Theme`, and `Verify` namespaces,
  plus `Event`, `Failure`, `Icons`, and `PartProps`. Keep it aligned with the package manifest and
  the packed artifact test.
- Every controller takes one options object and returns a named `Controller`. Build its `State`
  with `Data.taggedEnum`; never write a `{ _tag: "..." }` literal.
- `DomainKit.Root` takes the transport by value and keeps its identity for the mount. A change to
  the declared capability groups is the only thing that rebuilds it.
- Parts render only what `Transport.capabilities()` declares. `Domain.Flow` adds no layout
  container around a slot, so slot output stays a direct child of the flow root.
- `readOnly` on `DomainKit.Root` or `Domain.Flow` renders the state without the controls that
  change it, for authorization a transport cannot express. Parts read it through `useReadOnly()`.
  Observation stays available: checking DNS reads the world rather than changing the domain.
- An interactive connect returns the customer to the page they started from. `returnTo` on the
  connect controller and both flows names another destination; `null` defers to the server.
- `src/styles.css` ships wholly inside `@layer domainkit`, so a host's own rules win by default. An
  artifact test asserts the built stylesheet carries nothing outside that layer.
- Every user-visible string comes from `Messages.Catalog`, including one sentence per
  `DomainKit.Error` reason. No tag, status literal, or reason name reaches a customer.
- Icons come from the one context on `DomainKit.Root`; no part takes an icon prop. Provider artwork
  comes from `marks`, with the provider's initial as the fallback and no request at render time.
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

`release:check` runs typecheck, tests, build, the packed Vite and Next consumers, and the Playwright
run against `tests/browser/app`, a Vite fixture that renders `Domain.Flow` over
`Testing.transport()`. Finish with `git diff --check`.
