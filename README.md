# DomainKit

DomainKit helps SaaS teams build provider-connected domain setup into their products. It turns DNS
requirements into exact, reviewable plans and applies only an authorized digest while credentials,
persistence, and policy remain under application control.

Plans are additive and fail closed: missing records can be created, exact records are no-ops, and
incompatible state is reported as a conflict rather than overwritten.

## Packages

- [`domainkit`](./packages/domainkit/README.md) provides the Effect-native core and Promise facade.
- [`@domainkit/react`](./packages/react/README.md) provides browser-safe React flows over a host-owned transport.

The repository also contains the documentation application and an interactive React workshop under
[`apps/docs`](./apps/docs).
