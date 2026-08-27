# 0001: Portable protocol core

Status: Accepted

DomainKit is an independent, provider-neutral SDK. Its core uses ESM, Fetch, Web Crypto, and
serializable values so applications can adopt it without adopting a particular database, framework,
or integration runtime. Provider SDKs are avoided when a small documented HTTP surface is enough.

The initial runtime dependencies are `tldts` for registrable-domain/public-suffix behavior and
`oauth4webapi` for standards-sensitive OAuth mechanics. Provider adapters remain first-party modules
inside the package until their shared contract is proven.
