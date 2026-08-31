# @domainkit/react

Accessible React flows and composable UI parts for DomainKit.

The package can render the complete domain lifecycle, one focused lifecycle, or model-free DNS
records. Every stateful operation goes through your authenticated server transport; provider
credentials never belong in the browser.

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

`Domain.Flow` coordinates connection, plan review, apply, verification, receipt-bound cleanup, and
removing the domain grant. Your application still owns authentication, authorization, durable
attempts, provider credentials, and the server-side `Transport` implementation.

## Adopt only the surface you need

- `Domain.Flow` — the complete lifecycle;
- `Connection.Flow`, `Provisioning.Flow`, `Verification.Flow`, and `Cleanup.Flow` — focused flows;
- `useModel` hooks and semantic parts — host-owned composition and interaction chrome;
- `Records.Table`, `Records.Card`, and record parts — model-free DNS presentation without a root or
  transport.

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

The stylesheet is opt-in. `DomainKit.Root` accepts host messages, provider marks, icons, design
tokens, color scheme, and portal container, so product branding remains outside the package.
Recognized provider marks load from `integrations.sh` and fall back to the provider's initial when
the mark is unavailable; hosts can replace them through the `marks` prop.

## Learn more

- [React source and examples](https://github.com/AryaLabsHQ/domainkit/tree/main/packages/react)
- [Vite workshop source](https://github.com/AryaLabsHQ/domainkit/tree/main/packages/react/examples/vite)
- [Application transport contract](https://github.com/AryaLabsHQ/domainkit/blob/main/packages/domainkit/src/Transport.ts)
- [Issues](https://github.com/AryaLabsHQ/domainkit/issues)

## License

MIT
