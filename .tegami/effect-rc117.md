---
packages:
  domainkit:
    type: minor
  "@domainkit/capsuledb":
    type: minor
  "@domainkit/react":
    type: minor
---

## Effect 4.0.0-rc.117

DomainKit builds against Effect `4.0.0-rc.117`, and every package's `effect` peer range is now
`>=4.0.0-rc.117 <5.0.0`. Effect removed `Config.redacted` and `SchemaTransformation.transformOrFail`,
which `0.16.0` calls at import and layer build, so a host on a newer Effect needs this release and a
host on an older one upgrades Effect with it.

`Custody.layerConfig` reads `DOMAINKIT_CUSTODY_KEY` through `Config.Redacted`, and the examples and
READMEs use the PascalCase `Config` constructors. `@domainkit/capsuledb` reads `TIMESTAMPTZ` columns
whether `@effect/sql-pg` returns a `Date`, a `DateTime`, an epoch number, or a string.
