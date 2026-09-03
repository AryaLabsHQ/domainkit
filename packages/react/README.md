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
| `connection`   | `{ controller, domain }`                        | `Connect.Card` once connected, `Connect.Dialog` until then |
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
the domain.
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
so branding stays in your app. `Messages.Catalog` holds every user-visible string, including one
sentence per `DomainKit.Error` reason; nothing renders a tag. Provider artwork comes from `marks`,
with the provider's initial as the fallback and no request at render time. The stylesheet is
opt-in and every color is a `--domainkit-*` custom property.

Every rule ships inside `@layer domainkit`, so your own stylesheet wins without out-specifying a
part selector and a Tailwind utility class lands where you put it. To let the package win instead,
order a layer of your own below it:

```css
@layer domainkit, app;
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
