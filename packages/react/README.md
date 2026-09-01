# @domainkit/react

React flows and UI parts for DomainKit.

The package can render the full domain flow, one focused flow, or DNS records. Every stateful
operation goes through your authenticated server transport; provider credentials never belong in the
browser.

## Install

```sh
npm install @domainkit/react domainkit effect@rc @effect/atom-react@rc react react-dom
```

React 19 is required. Install `domainkit` and `@domainkit/react` at the same release version.

## Complete flow

```tsx
import { Domain, DomainKit } from "@domainkit/react";
import "@domainkit/react/styles.css";

export function DomainSetup() {
  return (
    <DomainKit.Root transport={transport}>
      <Domain.Flow domain="example.com" records={records} />
    </DomainKit.Root>
  );
}
```

`Domain.Flow` handles connection, plan review, apply, verification, cleanup, and removal of the
domain grant. Your app still owns authentication, authorization, saved attempts, provider
credentials, and the server-side `Transport` implementation.

## Choose the parts you need

- `Domain.Flow` — the full lifecycle;
- `Connection.Flow`, `Provisioning.Flow`, `Verification.Flow`, and `Cleanup.Flow` — focused flows;
- `useModel` hooks and parts — your own layout and controls;
- `Records.Table`, `Records.Card`, and record parts — DNS display without a root or transport.

The packaged flows use the same exported models and parts. Components support server rendering;
clipboard, download, and navigation behavior runs only from browser interactions.

## Host transport

```ts
import { Transport } from "domainkit";

export const transport = Transport.layerFromAsync({
  connection: api.connections,
  provisioning: api.provisioning,
  verification: api.verification,
  cleanup: api.cleanup,
});
```

The stylesheet is opt-in. `DomainKit.Root` accepts your messages, provider marks, icons, design
tokens, color scheme, and portal container, so branding stays in your app.
Known provider marks load from `integrations.sh` and fall back to the provider's initial when a mark
is unavailable. Replace them through the `marks` prop when your app owns the artwork.

## Learn more

- [React source and examples](https://github.com/AryaLabsHQ/domainkit/tree/main/packages/react)
- [React component catalog](https://domain-kit.dev/components)
- [Application transport contract](https://github.com/AryaLabsHQ/domainkit/blob/main/packages/domainkit/src/Transport.ts)
- [Issues](https://github.com/AryaLabsHQ/domainkit/issues)

## License

MIT
