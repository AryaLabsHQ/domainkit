## @domainkit/capsuledb@0.17.0

### CapsuleDB 0.3

`@domainkit/capsuledb` peers on `capsuledb` `>=0.3.0 <0.4.0`. CapsuleDB `0.3.0` builds against Effect
`4.0.0-rc.117`, and its `capsuledb emit` command runs on the same Effect as the rest of DomainKit, so
a host installs `capsuledb@0.3` alongside this release.

### Effect 4.0.0-rc.117

DomainKit builds against Effect `4.0.0-rc.117`, and every package's `effect` peer range is now
`>=4.0.0-rc.117 <5.0.0`. Effect removed `Config.redacted` and `SchemaTransformation.transformOrFail`,
which `0.16.0` calls at import and layer build, so a host on a newer Effect needs this release and a
host on an older one upgrades Effect with it.

`Custody.layerConfig` reads `DOMAINKIT_CUSTODY_KEY` through `Config.Redacted`, and the examples and
READMEs use the PascalCase `Config` constructors. `@domainkit/capsuledb` reads `TIMESTAMPTZ` columns
whether `@effect/sql-pg` returns a `Date`, a `DateTime`, an epoch number, or a string.

## @domainkit/capsuledb@0.16.0

### Plan many domains, approve once, apply bounded

Setting up several domains at once meant a host rebuilt the lifecycle DomainKit already guards for
one: a manifest over per-domain attempts, a digest the customer approves, a lease per item, a
resumable apply, and a way to find the setups still owed a move. `Provision.batch` is that
lifecycle inside DomainKit.

```ts
const batch =
  yield *
  provision.batch.create({
    idempotencyKey: request.idempotencyKey,
    items: zones.map((zone) => ({ domain: zone.domain, requirements: zone.requirements })),
  });
yield * provision.batch.approve(batch.id, { digest: batch.digest });
yield * provision.batch.apply(batch.id);
```

A batch is `planning` until every item has a plan, `planned` once it does, `approved` after one
digest-bound approval covers every plan, and `applying`, `complete`, `partial`, or `failed` as its
attempts move. `reject` closes a batch that was never approved. `create` replays by idempotency
key, `resumePlanning` re-plans the items whose plan failed, `apply` skips an item another apply
holds and returns, and `list({ unfinished: true })` answers every batch the owner still owes a
move on. Items point at attempts: plan, approval, receipt, and lease live once, on the attempt.

`Storage` gains `batches`; `@domainkit/capsuledb` adds `domainkit_batches` and
`domainkit_batch_items` as one additive migration; `domainkit/server` mounts the routes under
`/batches`. A digest that no longer matches fails `BatchStale`, which names the batch, its status,
and the digest it holds.

## @domainkit/capsuledb@0.12.0

### The attachments table remembers the zone's label

`domainkit_attachments` carries `label`, the provider's name for the zone at the moment the domain
was attached. A host that has already deployed picks the column up from the emitted migration; a
surface reading it names the account without a provider call.

## @domainkit/capsuledb@0.9.0

### DomainKit Storage on PostgreSQL as one declarative capsule

`PgStorage.layer()` provides `Storage.Service` over the host's `SqlClient` from one CapsuleDB
capsule with six tables, no host foreign keys, readiness keyed by domain, advisory-lock
`withLock`, `FOR UPDATE` attempt transitions including reject, and two-phase revocation guarded by
credential ciphertext. `mode: "prepare"` migrates at boot; `mode: "assert"` expects the SQL that
`capsuledb emit` writes. Depends on the published `capsuledb` 0.2 and stores rows in the core
schema's encoded form, so the row layout follows `Storage.ts`.

Breaking: `persistence.ts`, host bindings, and package-level custody are gone; credentials arrive
sealed by the core `Custody` service.

## @domainkit/capsuledb@0.1.0

### Add CapsuleDB persistence

Add optional PostgreSQL CapsuleDB persistence for the complete managed-DNS authorization lifecycle.
Hosts retain ownership of the exact SQL client, credential encryption, identity, tenancy, policy,
routes, audit, and consent.
