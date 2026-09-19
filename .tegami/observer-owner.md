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

## `Verify.Summarisable` is removed, and the shape it named is inlined

`summary` took a named public interface that existed only to let core `Readiness` and the wire
shape both fit it. Its parameter is now the same structural type written inline, so the shape is
read at the signature instead of through a name nothing else uses.

`Verify.Summarisable` is gone from the package's types. `summary`'s behaviour is unchanged and
every value that could be summarised before still can, so no call site moves; only code that
annotated a value with the type itself has to change, and it inlines the same shape:

```ts
const readiness: {
  readonly requirements: ReadonlyArray<{ readonly status: Storage.RequirementStatus }>;
} | null;
```

The type appeared in no reference inventory, no documentation page, and no example, and nothing
implemented it, which is why this is a patch on a `0.x` line rather than a change to the surface a
host was told to build against.
