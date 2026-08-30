# @domainkit/react

Copy a DNS record. Download a zone file. Then connect the domain if you want DomainKit to do the rest.

The presentational record parts take a `DnsRecord[]` and do not need `DomainKit.Root` or a transport.

```tsx
import { Records } from "@domainkit/react";
import "@domainkit/react/styles.css";

<Records.Table records={records} />
<Records.CopyValue value="v=spf1 include:example.net ~all" />
<Records.ZoneFile domain="mail.example.com" records={records} />
<Records.Card record={records[0]} />
<Records.Status evidence={{ _tag: "Found", recordId: "mx" }} />
```

`Records.Table` copies name and value per row. Pass `evidence` to add Found / Missing / Mismatch / Unavailable chips. `Records.Card` is the stacked layout for the same data. `Records.ZoneFile` copies and downloads BIND text via `Records.toZoneFile`.

## Install

```sh
npm install @domainkit/react domainkit react react-dom
```

## Domain lifecycle

When you do have a host-owned transport, `Domain.Flow` connects the provider, reviews an exact plan, observes DNS, removes receipt-bound records, and disconnects the current domain grant.

```tsx
import { Domain, DomainKit, type Transport } from "@domainkit/react";

export function DomainSetup() {
  return (
    <DomainKit.Root transport={transport}>
      <Domain.Flow domain="example.com" records={records} />
    </DomainKit.Root>
  );
}
```

`Provisioning.Flow` accepts `showRecords={false}` when the host already renders the DNS record list with `Records.Table`.

## Transport ownership

The browser transport is Promise-based. Implement it with authenticated application endpoints. Do not place provider credentials or provider API clients in the browser.

- `connection` detects providers, starts OAuth or token authorization, reuses an existing account, and removes one domain grant while preserving DNS.
- `provisioning` asks the server for an exact plan and applies only the returned digest.
- `verification.observe(config)` is the single observation operation. `sources` selects provider evidence, public DNS, or both.
- `cleanup` creates a fresh receipt-bound deletion plan and applies only its reviewed digest. The server fails closed when records drift or ownership cannot be proven.

All outcomes are discriminated with `_tag`.

## Composition and theming

Every semantic component accepts Base UI's `render` prop.

```tsx
<Connection.OAuthAction
  controller={controller}
  label="Connect"
  render={<MyButton variant="primary" />}
/>
```

`DomainKit.Root` sets theme tokens, messages, provider marks, color scheme, and a portal container. The stylesheet is opt-in and uses `--domainkit-*` CSS custom properties. Record parts pick those tokens up when they sit inside Root; they still function without it.

## Server rendering

The package is ESM and safe to import on the server. Clipboard and download run in the browser when the user clicks Copy or Download.
