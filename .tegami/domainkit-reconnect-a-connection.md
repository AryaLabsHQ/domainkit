---
packages:
  domainkit: minor
---

## Reconnecting keeps the connection it is about

`Connect.reconnect({ connectionId, method })` and `POST /connections/:connectionId/reconnections`
put a fresh credential behind the authorization a connection already points at. The connection
keeps its id and every domain stays attached to it, which is what a customer means when a provider
turns a credential down. Starting again could only mint a second account and then fail on the first
domain, because that domain is attached to the connection the provider rejected. The provider is
the connection's own; the zone check on every session still catches a credential that can no longer
reach a zone.
