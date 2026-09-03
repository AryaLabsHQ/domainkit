# 0001: Portable protocol core

## Status

Accepted

## Context

DomainKit must be usable by applications with different frameworks, persistence systems, and
deployment runtimes. DNS providers expose sufficient documented HTTP APIs, while registrable-domain
handling and OAuth contain standards-sensitive behavior that should not be reimplemented locally.

## Decision

The core is provider-neutral portable ESM built on Fetch, Web Crypto, and serializable protocol
values. It does not depend on a database, application framework, or integration runtime. Web
Crypto supplies plan digests and credential sealing, so no host-provided crypto service is needed.

`tldts` owns registrable-domain and public-suffix behavior. `oauth4webapi` owns OAuth protocol
mechanics. Provider adapters are `Provider.make` values over documented HTTP surfaces instead of
provider SDKs, which keeps the runtime boundary small.

## Consequences

- Applications supply their own persistence, transport, and runtime composition.
- Provider adapters decode external responses and classify provider failures into
  `DomainKit.Error` reasons explicitly.
- DomainKit accepts some focused HTTP implementation work in exchange for fewer runtime
  constraints.

## Alternatives considered

- Provider SDKs as the core abstraction leak provider-specific runtime and dependency choices
  into the portable contract.
- Developing the protocol inside one host application couples the public SDK to that
  application's storage and lifecycle.

## References

- `package.json`
- `src/DomainName.ts`
- `src/internal/oauth.ts`
- `src/internal/http.ts`
- `src/Provider.ts`
