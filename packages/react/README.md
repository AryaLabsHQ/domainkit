# @domainkit/react

Headless React hooks for custom-domain setup, over a transport your server owns. The package
supplies state, copy, and accessibility; your application supplies the markup. Provider credentials
never reach the browser.

## Install

```sh
npm install @domainkit/react domainkit effect@rc react react-dom
```

React 19 is required. Install `domainkit` and `@domainkit/react` at the same release version.

For the styled composition, add the flow from the DomainKit registry into your own shadcn kit:

```sh
npx shadcn@latest add https://domain-kit.dev/r/domain-flow.json
```

## One hook

```tsx
"use client";

import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { Domain, DomainKit } from "@domainkit/react";

const transport = Transport.fromFetch("/api/domainkit");

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];

function DomainSetup() {
  const flow = Domain.useFlow({ domain: "app.example.com", requirements });
  return <DomainFlowCard flow={flow} />;
}

export function DomainSettings() {
  return (
    <DomainKit.Root transport={transport}>
      <DomainSetup />
    </DomainKit.Root>
  );
}
```

`Domain.useFlow` connects a provider, plans the DNS changes, takes the customer's approval or
refusal, applies the plan, observes the records, and cleans them up against the apply receipt. It
returns the four controllers, the plan the rows report, the latest readiness, the capability groups
the transport declares, and a `FlowState` your own surface reads.

`Transport.fromFetch` points at the routes you mounted from `domainkit/server`. Writing it inline in
JSX is fine: `DomainKit.Root` keeps the transport's identity for the whole mount, so the controllers
do not restart on every render. Pass `revision` to re-inspect every mounted domain after a change
the UI did not make.

An interactive provider returns the customer to the page they started from. Pass `returnTo` to name
a different destination, or `null` to leave the server's `defaultReturnTo` in charge.

## What the flow says about a domain

`flow.state` is what DomainKit has to say, so your own offers can be ordered beside it rather than
competing with it.

| Field                        | Says                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `connected`                  | DomainKit holds a connection for this domain                  |
| `offering`                   | The connect surface has something to offer                    |
| `provider`, `label`          | Who holds the connection, and which account the records go to |
| `receiptId`, `applied`       | The apply this domain's records came from                     |
| `connection`, `provisioning` | The tag each controller's state carries                       |
| `readOnly`                   | The customer may read this domain but not write to it         |

Discovery names the provider whose nameservers serve the domain, and `Connect.hostProvider` returns
its descriptor. When no registered provider serves the zone there is nothing DomainKit can connect,
so `offering` is false. Pass `connect: "always"` to offer every provider anyway, or
`connect: "never"` for a domain your application has already settled another way.

Connecting is the customer saying yes to the records, so the plan builds itself the moment a
connection lands, after a token connect and after the customer returns from a provider. One
`approve` adds them, and the flow observes the domain again to read them back. A domain that already
holds an apply receipt plans again when a later observation reads one of its records back missing or
wrong, so records deleted at the provider are offered again from the same button. Records the flow's
own cleanup took away are not that.

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

`Connect.describeMethods` arranges one provider's auth methods into the interactive ones a customer
clicks through and the ones that ask for credentials, so a connect surface asks for one decision at
a time. `Connect.rejectedField` names the one field a rejection was about.

## Adding a domain

`Connect.useZones` lists every zone the workspace's accounts reach, `Connect.useAccounts` adds
another account without naming a domain, and `Connect.useDomainField` turns a text input into a
combobox over those zones: it returns `inputProps`, `listboxProps`, and `optionProps`, moves the
highlight with the arrow keys, and completes on Tab or Enter while keeping whatever subdomain was
typed in front of the zone.

```tsx
const { zones } = Connect.useZones();
const field = Connect.useDomainField({ zones, value, onChange: setValue, onResolve });

<input {...field.inputProps} />
<ul {...field.listboxProps}>
  {field.suggestions.map((zone) => (
    <li key={`${zone.connectionId}:${zone.zone}`} {...field.optionProps(zone)}>
      {zone.zone}
    </li>
  ))}
</ul>;
```

## The member view

A customer who may read a domain but not change it gets `readOnly`. State still reports; every
command that would change the domain refuses to run, at the controller rather than in your markup,
so a control you render anyway cannot reach the transport.

```tsx
<DomainKit.Root transport={transport} readOnly>
  <DomainSetup />
</DomainKit.Root>
```

`Domain.useFlow` takes the same flag when only one domain on the page is read-only, and it rides on
`flow.state.readOnly`, so your surface can say who may connect instead of rendering nothing.
Capability gating is the other half: a group the transport does not declare is absent from
`flow.capabilities`, so a transport built with
`Transport.fromFetch(url, { capabilities: ["connection", "verification"] })` already rules out
provisioning and cleanup. `readOnly` covers the authorization a transport cannot express, such as a
member of an organisation who reaches the same routes.

Verification does not wait for a connection: the flow observes the requirements it was given, so a
domain with no provider attached still reports which records are in place.

Observation stays available in read-only, because checking DNS reads the world rather than changing
the domain. Retrying is not: a flow that becomes read-only after a write failed keeps the failure
and re-inspects instead of resending the command.

## Words

`Messages.Catalog` holds every user-visible string, including a title and a description per
`DomainKit.Error` reason; nothing renders a tag, a status literal, or a reason name. Pass
`messages` to `DomainKit.Root` to override any key.

```tsx
const describe = Outcome.useDescribe();
const words = describe(error, { provider: "Cloudflare" });
```

## Records

`Records.statusOf` answers what one row has to say: the operation a pending plan holds for it, or
the status the last observation read back. `Records.useCopy` is the clipboard control a value
needs, and `Records.toZoneFile` and `Records.downloadZoneFile` spell the whole requirement set for a
customer who edits DNS by hand.

## Next.js

The package entry carries `"use client"`. A transport is an object of functions, so build it inside
a client module rather than passing one from a server component.

## Learn more

- [Registry](https://domain-kit.dev/components/registry)
- [React source](https://github.com/AryaLabsHQ/domainkit/tree/main/packages/react)
- [Transport contract](https://github.com/AryaLabsHQ/domainkit/blob/main/packages/domainkit/src/Transport.ts)
- [Issues](https://github.com/AryaLabsHQ/domainkit/issues)

## License

MIT
