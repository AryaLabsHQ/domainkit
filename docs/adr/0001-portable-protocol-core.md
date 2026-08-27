# 0001: Portable protocol core

## Status

Accepted

## Context

DomainKit must be usable by applications with different frameworks, persistence systems, and
deployment runtimes. DNS providers expose sufficient documented HTTP APIs, while registrable-domain
handling and OAuth contain standards-sensitive behavior that should not be reimplemented locally.

## Decision

The core is provider-neutral portable ESM built on Fetch, Web Crypto, and serializable protocol
values. It does not depend on a database, application framework, or integration runtime.

`tldts` owns registrable-domain and public-suffix behavior. `oauth4webapi` owns OAuth protocol
mechanics. Provider adapters implement DomainKit's narrow provider contract and use documented HTTP
surfaces instead of provider SDKs when that keeps the runtime boundary smaller.

## Consequences

- Applications can supply their own persistence, transport, and runtime composition.
- Provider adapters must decode external responses and classify provider failures explicitly.
- DomainKit accepts some focused HTTP implementation work in exchange for fewer runtime constraints.

## Alternatives considered

- Provider SDKs as the core abstraction were rejected because they leak provider-specific runtime
  and dependency choices into the portable contract.
- Developing the protocol inside one host application was rejected because it would couple the
  public SDK to that application's storage and lifecycle.

## References

- `package.json`
- `src/discovery/zones.ts`
- `src/auth/oauth.ts`
- `src/provider/provider.ts`
