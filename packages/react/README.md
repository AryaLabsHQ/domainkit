# @domainkit/react

React flows for custom-domain setup, over a transport your server owns. Provider credentials never
reach the browser.

## Install

```sh
npm install @domainkit/react domainkit effect@rc react react-dom
```

React 19 is required. Install `domainkit` and `@domainkit/react` at the same release version.

## Two components

```tsx
import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { Domain, DomainKit } from "@domainkit/react";
import "@domainkit/react/styles.css";

const transport = Transport.fromFetch("/api/domainkit");

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];

export function DomainSettings() {
  return (
    <DomainKit.Root transport={transport} colorScheme="inherit">
      <Domain.Flow domain="app.example.com" requirements={requirements} />
    </DomainKit.Root>
  );
}
```

`Domain.Flow` connects a provider, plans the DNS changes, takes the customer's approval or refusal,
applies the plan, observes the records, and cleans them up against the apply receipt. It renders
only the capability groups the transport declares.

`Transport.fromFetch` points at the routes you mounted from `domainkit/server`. Writing it inline in
JSX is fine: `DomainKit.Root` keeps the transport's identity for the whole mount, so the controllers
do not restart on every render. Pass `revision` to re-inspect every mounted domain after a change
the UI did not make.

An interactive provider returns the customer to the page they started from. Pass `returnTo` to name
a different destination, or `null` to leave the server's `defaultReturnTo` in charge.

## The disconnected offer

Discovery names the provider whose nameservers serve the domain. `Connect.Prompt` states it beside a
trigger, and the dialog behind that trigger is narrowed to that provider, with the rest behind a
disclosure.

When no registered provider serves the zone there is nothing DomainKit can connect, so the flow
offers nothing. Pass `connect="always"` to offer the all-providers dialog anyway:

```tsx
<Domain.Flow domain="app.example.com" requirements={requirements} connect="always" />
```

## Own one piece, keep the rest

Every part of the flow is a slot with a default.

```tsx
<Domain.Flow
  domain="app.example.com"
  requirements={requirements}
  slots={{
    records: ({ records, readiness }) => <MyTable records={records} readiness={readiness} />,
  }}
  onApplied={(receipt) => track("dns.applied", { receiptId: receipt.id })}
/>
```

| Slot           | Receives                                        | Default                                                    |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `connection`   | `{ controller, domain, connect }`               | `Connect.Card` once connected, `Connect.Prompt` until then |
| `records`      | `{ records, readiness, controller, domain }`    | `Records.Table`                                            |
| `verification` | `{ controller, domain }`                        | `Verify.Status` with per-requirement evidence              |
| `actions`      | `{ connection, provisioning, cleanup, domain }` | Review changes, Approve, Decline, Remove records           |

`Domain.Flow` adds no layout container around a slot: its output is a direct child of the flow root,
so your own grid can place it without `display: contents`.

## The member view

A customer who may read a domain but not change it gets `readOnly`. Status renders; every control
that would start a write does not.

```tsx
<DomainKit.Root transport={transport} readOnly>
  <Domain.Flow domain="app.example.com" requirements={requirements} />
</DomainKit.Root>
```

`Domain.Flow` takes the same flag when only one domain on the page is read-only, and `useReadOnly()`
tells a part of your own which mode it is in. Capability gating is the other half: a group the
transport does not declare never renders, so a transport built with
`Transport.fromFetch(url, { capabilities: ["connection", "verification"] })` already hides
provisioning and cleanup. `readOnly` covers the authorization a transport cannot express, such as a
member of an organisation who reaches the same routes.

Verification does not wait for a connection: the flow observes the requirements it was given, so a
domain with no provider attached still reports which records are in place.

Observation stays available in read-only, because checking DNS reads the world rather than changing
the domain. Retrying is not: a flow that becomes read-only after a write failed keeps the failure on
screen and drops the retry.
If your `Identity.authorize` denies `observe` to members, pass `slots={{ verification: () => null }}`.

## Controllers

Compose the flow yourself from the same hooks. Each takes one options object and returns a named
`Controller` whose `State` is a tagged union.

```tsx
const connection = Connect.useController({ domain });
const provisioning = Provision.useController({ domain, requirements, onApplied });
const cleanup = Cleanup.useController({ domain, receiptId, onCleaned });
const verification = Verify.useController({ domain, polling: true });
```

`approve` authorizes the plan digest and applies it. `reject` records the customer's refusal; the
attempt is terminal and a new plan is needed. `retry` builds a new plan when the reason says the old
one is gone, and re-runs the failed step otherwise.

## Presentation

`DomainKit.Root` takes `messages`, `marks`, `icons`, `theme`, `colorScheme`, and `portalContainer`,
so branding stays in your app. `Messages.Catalog` holds every user-visible string, including a
title and a description per `DomainKit.Error` reason; nothing renders a tag. Provider artwork comes from `marks`,
with the provider's initial as the fallback and no request at render time. The stylesheet is
opt-in and every color is a `--domainkit-*` custom property.

Every rule ships inside `@layer domainkit`. An unlayered rule of yours already beats every layer, so
plain CSS needs nothing here.

Once your app uses layers, name the order yourself: a layer's priority is its position in that list,
and a layer you never declare lands wherever it first appears, so `domainkit` can sort under
Tailwind's preflight and the package's buttons render as bare text.

```css
@layer theme, base, components, domainkit, utilities;
```

`domainkit` sits after `base` so preflight cannot strip it, and before `utilities` so a utility class
still wins. Any layer you declare after it wins the same way:

```css
@layer utilities {
  [data-domainkit-part="records-panel"] {
    border-radius: 0;
  }
}
```

A failed step renders as `Outcome`: media, the catalog's title and description, and the retry the
flow allows, as a card or on one line. Pass your own parts as children and the words still come from
the catalog.

```tsx
<Connect.Outcome controller={connection} layout="inline">
  <Outcome.Media variant="default">
    <MyIcon />
  </Outcome.Media>
  <Outcome.Title />
  <Outcome.Content />
</Connect.Outcome>
```

Every dialog and popover takes a `render` prop that replaces the surface with your own.

## Next.js

The package entry carries `"use client"`. A transport is an object of functions, so build it inside
a client module rather than passing one from a server component.

## Learn more

- [React source](https://github.com/AryaLabsHQ/domainkit/tree/main/packages/react)
- [Transport contract](https://github.com/AryaLabsHQ/domainkit/blob/main/packages/domainkit/src/Transport.ts)
- [Issues](https://github.com/AryaLabsHQ/domainkit/issues)

## License

MIT
