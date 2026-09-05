---
packages:
  "@domainkit/capsuledb": minor
---

## The attachments table remembers the zone's label

`domainkit_attachments` carries `label`, the provider's name for the zone at the moment the domain
was attached. A host that has already deployed picks the column up from the emitted migration; a
surface reading it names the account without a provider call.
