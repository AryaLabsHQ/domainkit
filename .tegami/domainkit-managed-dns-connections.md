---
packages:
  domainkit: minor
---

Replace the public domain-grant and provider-account deduplication model with
`ProviderConnection`, `ProviderTarget`, and `DomainAttachment`. Provider credentials may back
multiple explicitly linked organization connections, while exact domain attachments own DNS
operation authorization and disconnects revoke the shared provider authorization only after the
final organization connection is removed.
