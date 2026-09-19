---
packages:
  domainkit:
    type: patch
---

## `Verify.ReadinessChanged` names the tenant it was written for

Readiness is stored per owner and domain, but the observer event carried only `domain`,
`readiness`, and `cause`. An observer provided with `Layer.succeed(Verify.Observer, ...)` over
`DomainKit.layer` is bound to the layer rather than to one request, so a host serving more than one
tenant could not tell whose readiness had just been written when the same domain name is attached
in two tenants at once.

`readinessChanged` now receives `ownerId`, taken from the `Principal` the write ran as, for both
causes. Key a projection by `ownerId` and `domain`. Only the owner is carried: readiness is scoped
by owner, not by actor, and the observer is a projection seam rather than an audit trail.
