---
packages:
  domainkit: minor
---

## The account is the unit of consent

`Server.StartPayload.domain` is optional. A start without one connects the account and attaches
nothing, and `Started.Connected` carries the connection it made: `connectionId`, `provider`, the
`label` the customer reads, and `snapshot` only when a domain was given.

`Connect.zones({ provider? })` and `GET /zones` list every zone the principal's connections reach
through `Provider.Session.listTargets`, ordered by zone, each with the connection that serves it
and the label the provider gave it. A connection whose credential the provider turned down is
reported once in the sibling `connections` array as `reconnect` and contributes no zones, so one
dead account never costs the customer the others. The reply also carries the provider catalog, so a
picker offers a new account without a second call.

`Storage.Attachment.label` holds the zone's label at attach time, across memory and Postgres
storage, and `Snapshot.attachment` replaces `attachmentId` with `{ id, label }`, so a surface names
the account the records go to without asking the provider again. `Transport.provisioning.receipt`
reads one apply receipt by id.
