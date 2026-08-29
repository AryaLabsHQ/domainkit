---
packages:
  domainkit:
    type: patch
---

## Reuse an existing provider connection for another domain

Add `Connection.extend` to the Effect-native and Promise APIs. Hosts can extend an owner's stored
domain grant after proving provider ownership and obtaining consent, without repeating provider
authentication. Extension preserves existing grants and rejects cross-owner, expired, or revoking
connections.
