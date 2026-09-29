---
packages:
  "@domainkit/capsuledb":
    type: minor
---

## Prepare Storage at deploy time, check it on first use

`PgStorage.manifest()` returns the CapsuleDB manifest for exactly the capsule `PgStorage.layer()`
installs, so a deploy stack can hand it to `CapsuleDB.Registry` from `capsuledb/alchemy` and prepare
the schema the function will assert:

```ts
const manifest = yield * PgStorage.manifest();
const registry =
  yield *
  CapsuleDB.Registry("domainkit-storage", {
    url,
    provider: "Postgres",
    manifest,
  });
```

`PgStorage.layer` takes a `readiness` option. `"boot"` (the default) checks while the layer builds.
`"first-use"` builds without a statement and runs one cached check before the first Storage query,
so a serverless function boots with `{ mode: "assert", readiness: "first-use" }` and a cold start
that never reaches Storage does no registry work. A failed check surfaces as a `SqlError` on that
query and is retried on the next.

The package now peers on `capsuledb` `>=0.4.0 <0.5.0`.
