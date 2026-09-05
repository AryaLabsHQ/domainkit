---
packages:
  "@domainkit/react": minor
---

## Connecting a domain that needs reconnecting re-credits what it has

`Connect.useController`'s `connect` proves the same provider again for a connection the provider
turned down, rather than starting a second one, so the domains on it stay where they are. The
domain field's footer offers the same for an account its listing reports as `reconnect`, through
`Connect.useAccounts`'s new `reconnect` command.
