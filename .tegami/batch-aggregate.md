---
packages:
  domainkit:
    type: minor
  "@domainkit/capsuledb":
    type: minor
---

## Plan many domains, approve once, apply bounded

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
