# @domainkit/react

Accessible, composable React flows for connecting domains, reviewing DNS changes, observing
propagation, and safely disconnecting domains through a host-owned DomainKit transport.

## Install

```sh
npm install @domainkit/react domainkit react react-dom
```

Import the optional default styles once in your application:

```ts
import "@domainkit/react/styles.css";
```

## Complete flow

```tsx
import { Domain, DomainKit, type Transport } from "@domainkit/react";

const records: ReadonlyArray<Transport.DnsRecord> = [
  {
    id: "dkim",
    type: "TXT",
    name: "mail._domainkey.example.com",
    value: "v=DKIM1; p=...",
  },
];

export function DomainSetup() {
  return (
    <DomainKit.Root transport={transport}>
      <Domain.Flow domain="example.com" records={records} />
    </DomainKit.Root>
  );
}
```

`Domain.Flow` composes the connection, provisioning, verification, cleanup, and current-domain
disconnect states. Each namespace also exports its controller and presentational components for
applications that need a different layout.

## Transport ownership

The browser transport is intentionally narrow and Promise-based. Implement it with authenticated
application endpoints; do not place provider credentials or provider API clients in the browser.

- `connection` detects providers, starts OAuth or token authorization, reuses an existing account,
  and removes one domain grant while preserving DNS.
- `provisioning` asks the server for an exact plan and applies only the returned digest. The server
  owns plan construction, authorization, idempotency, and receipts.
- `verification.observe(config)` is the single observation operation. Its `sources` config selects
  provider evidence, public DNS evidence, or both.
- `cleanup` creates a fresh receipt-bound deletion plan and applies only its reviewed digest. The
  server must fail closed when records drift or ownership cannot be proven.

All outcomes are discriminated with `_tag`, so consumers can handle every state exhaustively.

## Composition and theming

Every semantic component accepts Base UI's `render` prop. Replace an element without losing its
behavior:

```tsx
<Connection.OAuthAction
  controller={controller}
  label="Connect"
  render={<MyButton variant="primary" />}
/>
```

Use `DomainKit.Root` to set typed theme tokens, messages, provider marks, color scheme, or a custom
portal container:

```tsx
<DomainKit.Root
  colorScheme="dark"
  messages={{ checkDns: "Verify records" }}
  theme={{ accent: "#6d28d9", radius: "0.75rem" }}
  transport={transport}
>
  {children}
</DomainKit.Root>
```

The stylesheet is opt-in and uses `--domainkit-*` CSS custom properties. It supports light, dark,
inherited color schemes, custom tokens, and reduced motion. Provider marks are replaceable through
the `marks` prop.

## Server rendering

The package is ESM and safe to import and render on the server. Browser navigation, clipboard,
downloads, provider authorization, and persistence remain explicit host responsibilities.
