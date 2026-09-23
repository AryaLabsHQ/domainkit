# `@domainkit/capsuledb`

DomainKit's `Storage` on PostgreSQL, as one declarative [CapsuleDB](https://github.com/aryasaatvik/CapsuleDB)
capsule. Install it under `DomainKit.layer` and the whole durable lifecycle — provider
authorizations, connections, attachments, interactive-flow continuations, plan/approval/receipt
attempts, multi-domain batches, and observed readiness — lives in your database, scoped to your
tenants.

The host owns the `SqlClient` and its lifetime. This package owns its own tables and never exposes
rows, queries, or a raw client.

## Install

```sh
bun add @domainkit/capsuledb capsuledb @effect/sql-pg
```

## Wire it up

```ts
import { Config, Layer } from "effect";
import { PgClient } from "@effect/sql-pg";
import { Cloudflare, Custody, DomainKit, Vercel } from "domainkit";
import { PgStorage } from "@domainkit/capsuledb";

export const DomainKitLive = DomainKit.layer({
  providers: [
    Cloudflare.provider({
      oauth: {
        clientId: Config.String("CF_CLIENT_ID"),
        clientSecret: Config.Redacted("CF_CLIENT_SECRET"),
      },
    }),
    Vercel.provider(),
  ],
}).pipe(
  // `provideMerge`, not `provide`: `domainkit/server`'s handlers read attempts and receipts
  // straight from Storage, so the layer they are given has to still carry it.
  Layer.provideMerge(Layer.mergeAll(PgStorage.layer(), Custody.layerConfig())),
  Layer.provide(PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })),
);
```

`PgStorage.layer()` prepares at boot: it creates CapsuleDB's ledger, applies pending migrations, and
only then provides `Storage`. A capsule service can never observe a database whose tables are
missing.

`Custody.layerConfig()` reads `DOMAINKIT_CUSTODY_KEY` and seals every provider credential before it
reaches a row. Swap it for a KMS with `Custody.layerFromAsync`; there is no plaintext mode, and this
package never sees one.

## Or emit the SQL and assert at boot

If your migrations are yours to run, take the SQL instead:

```sh
capsuledb emit \
  --module ./node_modules/@domainkit/capsuledb/dist/index.mjs \
  --export capsule \
  --dialect postgres \
  --out ./drizzle
```

That writes CapsuleDB's ledger DDL, the capsule's migration, and a readiness row, plus a
`capsuledb.emit.json` index naming the files it owns. Apply them with your own pipeline, then boot
in assert mode:

```ts
PgStorage.layer({ mode: "assert" });
```

Assert mode applies nothing and fails unless the database already matches the capsule, so a missed
migration is a boot failure rather than a runtime surprise. `capsuledb check` compares an emitted
folder against the current capsule in CI.

## Tables

| Table                      | Key                                        | Holds                                                                            |
| -------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| `domainkit_authorizations` | `id`                                       | provider grant, account label, capabilities, revocation state, sealed credential |
| `domainkit_connections`    | `id`                                       | the principal-facing handle over one authorization                               |
| `domainkit_attachments`    | `id`, unique `(owner_id, domain)`          | domain, zone, provider target                                                    |
| `domainkit_continuations`  | `id`                                       | interactive-flow state with a TTL                                                |
| `domainkit_attempts`       | `id`                                       | plan, approval, receipt, status, lease, failure                                  |
| `domainkit_readiness`      | `(owner_id, domain)`                       | latest observation, per-requirement evidence, backoff                            |
| `domainkit_batches`        | `id`, unique `(owner_id, idempotency_key)` | batch status, approval digest, rejection                                         |
| `domainkit_batch_items`    | `(batch_id, attachment_id)`                | one domain's place in a batch: position, attempt pointer, plan failure           |

A batch item is a pointer: the plan, approval, receipt, lease, and failure it shows a customer all
live on the attempt it names, so nothing is stored twice and the batch's status is recomputed from
those attempts inside the transaction that moves it.

Readiness is keyed by domain rather than by attachment, so a host observing public DNS alone gets
the same row; `attachment_id` links the attachment when one exists and is cleared when it is
removed.

Every table carries `owner_id`, and every query filters by the `Principal.Service` your host provides, so a
row belonging to another tenant reads as absent. No foreign keys are declared, to your tables or
between these; add the ones you want in the emitted SQL.

`PgStorage.layer({ prefix })` renames the tables. The prefix is part of the physical layout: it
changes the rendered DDL and the migration checksum, so fix it before the first deploy and never
change it after. `registryPrefix` does the same for CapsuleDB's own ledger tables and must match
`capsuledb emit --prefix`.

## What it guarantees

- Aggregate transitions — approve, claim, complete, fail, capability promotion, credential
  replacement — run in one transaction over a `FOR UPDATE` row.
- A continuation is consumed by `DELETE ... RETURNING`, so a replayed OAuth callback fails
  `NotFound` instead of connecting twice.
- Revocation is two-phase: mark `pending`, call the provider outside the transaction, then delete
  the row only while it still holds the credential that was revoked. A crash in between, or a
  refresh that rotated the credential mid-revoke, leaves a row `recoverRevocations` finishes later,
  so a newly issued credential is never orphaned at the provider.
- `withLock` takes a session advisory lock on a reserved connection and fails `Busy` rather than
  waiting, so a credential refresh single-flights without holding a transaction across an HTTP call.

The package passes `Testing.conformance.storage` from `domainkit/testing`, the same suite the
in-memory implementation passes.
