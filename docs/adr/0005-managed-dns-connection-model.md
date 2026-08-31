# Managed DNS connection model

## Context

The original connection API combined provider credential ownership, organization binding, and
domain access in a public grant algebra. That made the host coordinate account deduplication,
grant contraction, and final revocation across several stores. It also made a provider account
look like the durable identity even though one credential can be used by more than one organization.

## Decision

DomainKit keeps three relationships in one host-provided managed-DNS lifecycle capability:

1. one internal provider authorization owns credential lifecycle and capability evidence;
2. explicit organization-owned `ProviderConnection` rows reference that authorization; and
3. exact `DomainAttachment` rows reference one connection and carry the selected
   `ProviderTarget` (provider account, account kind, zone ID, and zone name).

The public connection surface exposes only `ProviderConnection`, `ProviderTarget`, and
`DomainAttachment`. The provider authorization, credential material, authorization ID, persistence
aggregate, and revocation bookkeeping stay behind the lifecycle capability. A connection may exist
without attachments. Attaching an additional organization requires the host to supply an explicit
authorization ID after a fresh provider proof; the core never deduplicates by provider account.

Attachment authorization requires the persisted attachment, its owner connection, and an active,
unexpired authorization with evidence for the requested capability. A connection cannot be
disconnected while it still has attachments. Removing the final organization connection marks the
shared authorization pending, invokes the provider-defined revocation callback, and deletes local
authorization state only after revocation succeeds. Failed revocation remains recoverable.

## Consequences

- The change is intentionally breaking: `Grant`, `includeDomains`, `removeDomain`, `assertGrant`,
  excluded-domain state, and implicit provider-account reuse are removed.
- Hosts implement one cohesive lifecycle capability rather than repository-per-table public
  interfaces, while retaining freedom over SQL, vault, and transaction strategy.
- OAuth and token authentication still resolve provider subject/account identity transiently; that
  identity is persisted only in an exact target attachment when the host selects a zone.
