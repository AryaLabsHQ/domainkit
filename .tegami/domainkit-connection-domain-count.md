---
packages:
  domainkit: patch
---

## The snapshot counts the domains a connection serves

`Connect.Snapshot.connectionDomains` counts the attachments on this domain's connection, this
domain included, and is `0` without one. The discovery route and `Transport` carry it, so a surface
can ask whether letting the connection go takes other domains with it before it offers the choice.
