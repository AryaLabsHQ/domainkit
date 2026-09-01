# DomainKit

DomainKit helps SaaS teams add custom domains to their products. It turns DNS requirements into plans
you can review, applies only an approved plan, and records what happened while your app keeps control
of credentials, storage, and policy.

Plans are additive and fail closed: missing records can be created, exact records are no-ops, and
incompatible state is reported as a conflict rather than overwritten.

## Current packages

The current public releases are `domainkit@0.8.0`, `@domainkit/react@0.8.0`, and
`@domainkit/capsuledb@0.1.2`.

## Entry points

- [`domainkit`](./packages/domainkit/README.md) provides the Effect core and Promise API.
- `domainkit/server` provides server routes plus `createDomainKit` for async hosts.
- [`@domainkit/react`](./packages/react/README.md) provides React flows over your server transport.
- [`@domainkit/capsuledb`](./packages/capsuledb/README.md) provides optional PostgreSQL storage for Effect hosts.

Your app owns server routes, credentials, storage, identity, tenancy, consent, and audit. Async hosts
provide their own storage; CapsuleDB is an Effect option.

The repository also contains the docs app and its interactive React component catalog under
[`apps/docs`](./apps/docs).
