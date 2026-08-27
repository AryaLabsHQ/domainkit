# Contributing

DomainKit defines a small, auditable public contract for DNS provisioning. Changes should keep
provider APIs, host storage, and product UI outside the core protocol unless an accepted architecture
decision says otherwise.

## Development

Use Bun 1.4 and Node.js 24.10 or newer:

```sh
bun install --frozen-lockfile
bun run release:check
```

Add focused tests for observable behavior and document exported APIs. Pull requests should contain
one coherent change and explain any public contract change.

## Compatibility

While the public contract is pre-1.0, APIs may change directly. Once a stable contract is declared,
breaking changes will be explicit and versioned.
