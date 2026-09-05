---
packages:
  "@domainkit/react": minor
---

## Adding a domain is one input

`Connect.DomainField` loads the zones every connected account reaches, filters them as the customer
types, completes the highlighted one on Tab or Enter while keeping whatever subdomain was typed in
front of it, and says in its footer where the records will go: the account that serves the zone,
"Not in a connected account." for a domain outside all of them, a reconnect for an account the
provider turned down, or the providers to connect when the workspace holds none. Arrow keys move the
highlight and Escape closes the list; the input stays a plain text field for a domain no account
reaches. Parts: `domain-field`, `domain-input`, `domain-suggestions`, `domain-suggestion`,
`domain-field-footer`.

`Connect.useZones({ provider? })` reads the listing. `Connect.useAccounts({ returnTo })` adds the
one command that grows it: connect a provider with no domain attached, by redirect for a
click-through method and through a token dialog for a provider that offers nothing else.
