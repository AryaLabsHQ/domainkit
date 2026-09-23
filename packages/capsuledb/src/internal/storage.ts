/**
 * `Storage.Interface` on PostgreSQL.
 *
 * Every method reads `Principal` and filters by `owner_id`, so a row belonging to another tenant
 * is indistinguishable from a row that does not exist. Aggregate transitions run inside one
 * transaction over a `FOR UPDATE` row, single-flight guards use a session-level advisory lock on a
 * reserved connection, and revocation is two-phase: mark `pending`, call the provider outside any
 * transaction, then delete.
 *
 * Storage never sees plaintext. `Connect` seals a credential through `Custody` before it reaches
 * `upsert` or `rotate`, so this module only ever moves a ciphertext string.
 */
import { type Approval, DomainKit, type Plan, Principal, Reason, Storage } from "domainkit";
import { DateTime, Effect, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";

import type { Tables } from "./tables.ts";

type Fail = DomainKit.Error;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

const fail = (reason: Reason.Model) => Effect.fail(new DomainKit.Error({ reason }));

const notFound = (entity: Reason.NotFound["entity"], id: string) =>
  fail(new Reason.NotFound({ entity, id }));

const invalid = (message: string, field?: string) =>
  fail(new Reason.InvalidInput({ message, ...(field === undefined ? {} : { field }) }));

const busy = (key: string) => fail(new Reason.Busy({ key }));

const storageFailed = (operation: string, message: string) =>
  new DomainKit.Error({
    reason: new Reason.StorageFailed({ operation, message }),
  });

const sqlMessage = (error: SqlError.SqlError): string =>
  error.reason.cause instanceof Error
    ? `${error.reason._tag}: ${error.reason.cause.message}`
    : `${error.reason._tag}: ${String(error.reason.cause)}`;

/**
 * Collapse the SQL error channel into `DomainKit.Error`.
 *
 * A `DomainKit.Error` raised by the body is the deliberate outcome of an invariant and passes
 * through unchanged; anything else is a driver failure and becomes `StorageFailed`.
 */
const guard =
  (operation: string) =>
  <A, R>(effect: Effect.Effect<A, SqlError.SqlError | Fail, R>): Effect.Effect<A, Fail, R> =>
    Effect.catch(effect, (error) =>
      Effect.fail(DomainKit.isError(error) ? error : storageFailed(operation, sqlMessage(error))),
    );

// ---------------------------------------------------------------------------------------------
// Row codecs
// ---------------------------------------------------------------------------------------------

/**
 * A row is stored as its schema's encoded form spread over columns, so the core schema stays the
 * only description of a row's shape. Reading reassembles the encoded object and decodes it.
 */
const codec = <S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S, subject: string) => {
  const decode = Schema.decodeUnknownEffect(schema);
  const encode = Schema.encodeUnknownEffect(schema);
  return {
    read: (input: unknown): Effect.Effect<S["Type"], Fail, S["DecodingServices"]> =>
      decode(input).pipe(
        Effect.mapError((error) =>
          storageFailed(`${subject}.decode`, `stored ${subject} is invalid: ${error.message}`),
        ),
      ),
    write: (value: S["Type"]): Effect.Effect<S["Encoded"], Fail, S["EncodingServices"]> =>
      encode(value).pipe(
        Effect.mapError((error) =>
          storageFailed(`${subject}.encode`, `${subject} cannot be stored: ${error.message}`),
        ),
      ),
  };
};

const authorizationCodec = codec(Storage.Authorization, "authorization");
const connectionCodec = codec(Storage.Connection, "connection");
const attachmentCodec = codec(Storage.Attachment, "attachment");
const continuationCodec = codec(Storage.Continuation, "continuation");
const continuationHeaderCodec = codec(Storage.ContinuationHeader, "continuation header");
const attemptCodec = codec(Storage.Attempt, "attempt");
const batchCodec = codec(Storage.Batch, "batch");
const batchItemCodec = codec(Storage.BatchItem, "batch item");
const readinessCodec = codec(Storage.Readiness, "readiness");
const credentialCodec = codec(Storage.Credential, "credential");

// ---------------------------------------------------------------------------------------------
// Column conversions
// ---------------------------------------------------------------------------------------------

/** A `TIMESTAMPTZ` column as the ISO string every DomainKit timestamp schema encodes to. */
const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (DateTime.isDateTime(value)) return DateTime.toDateUtc(value).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return String(value);
};

const isoOrNull = (value: unknown): string | null => (value === null ? null : iso(value));

/** An ISO string from a schema's encoded form as the `Date` the driver binds to `TIMESTAMPTZ`. */
const at = (value: string): Date => new Date(value);

const atOrNull = (value: string | null): Date | null => (value === null ? null : at(value));

const now = Effect.map(DateTime.now, DateTime.toDateUtc);

/**
 * A `JSONB` column as a plain value.
 *
 * Drivers disagree about whether they parse JSON columns, so accept both and normalize here
 * rather than depending on a host's client configuration.
 */
const fromJson = (value: unknown): unknown =>
  typeof value === "string" ? (JSON.parse(value) as unknown) : value;

const fromJsonOrNull = (value: unknown): unknown => (value === null ? null : fromJson(value));

/** Bind a value to a `JSONB` column as text; PostgreSQL coerces the untyped parameter. */
const toJson = (value: unknown): string => JSON.stringify(value ?? null);

const toJsonOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : toJson(value);

// ---------------------------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------------------------

interface AuthorizationRow {
  readonly id: string;
  readonly owner_id: string;
  readonly provider: string;
  readonly method: string;
  readonly capabilities: unknown;
  readonly context: unknown;
  readonly label: string | null;
  readonly revocation: string;
  readonly created_by: string;
  readonly created_at: unknown;
  readonly credential_ciphertext: string;
  readonly credential_expires_at: unknown;
  readonly credential_rotated_at: unknown;
}

interface ConnectionRow {
  readonly id: string;
  readonly owner_id: string;
  readonly authorization_id: string;
  readonly created_at: unknown;
}

interface AttachmentRow {
  readonly id: string;
  readonly owner_id: string;
  readonly connection_id: string;
  readonly domain: string;
  readonly zone: string;
  readonly label: string;
  readonly target: unknown;
  readonly created_at: unknown;
}

interface ContinuationRow {
  readonly id: string;
  readonly owner_id: string;
  readonly actor_id: string;
  readonly provider: string;
  readonly payload: unknown;
  readonly return_to: string | null;
  readonly expires_at: unknown;
}

interface AttemptRow {
  readonly id: string;
  readonly owner_id: string;
  readonly attachment_id: string;
  readonly kind: string;
  readonly status: string;
  readonly plan: unknown;
  readonly approval: unknown;
  readonly receipt: unknown;
  readonly rejection: unknown;
  readonly source_receipt_id: string | null;
  readonly lease_expires_at: unknown;
  readonly failure: string | null;
  readonly updated_at: unknown;
}

interface BatchRow {
  readonly id: string;
  readonly owner_id: string;
  readonly kind: string;
  readonly status: string;
  readonly digest: string | null;
  readonly approval: unknown;
  readonly rejection: unknown;
  readonly idempotency_key: string;
  readonly created_by: string;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly completed_at: unknown;
}

interface BatchItemRow {
  readonly batch_id: string;
  readonly attachment_id: string;
  readonly position: number;
  readonly attempt_id: string | null;
  readonly plan_failure: string | null;
}

/** An item row with its attempt's status joined in; null while the item carries no plan. */
interface BatchItemStatusRow extends BatchItemRow {
  readonly attempt_status: string | null;
}

interface ReadinessRow {
  readonly owner_id: string;
  readonly domain: string;
  readonly attachment_id: string | null;
  readonly overall: string;
  readonly requirements: unknown;
  readonly host: unknown;
  readonly pending_since: unknown;
  readonly checked_at: unknown;
  readonly next_check_at: unknown;
}

const authorizationOf = (row: AuthorizationRow) =>
  authorizationCodec.read({
    id: row.id,
    ownerId: row.owner_id,
    provider: row.provider,
    method: row.method,
    capabilities: fromJson(row.capabilities),
    context: fromJson(row.context),
    label: row.label,
    revocation: row.revocation,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  });

const credentialOf = (row: AuthorizationRow) =>
  credentialCodec.read({
    ciphertext: row.credential_ciphertext,
    expiresAt: isoOrNull(row.credential_expires_at),
    rotatedAt: iso(row.credential_rotated_at),
  });

const connectionOf = (row: ConnectionRow) =>
  connectionCodec.read({
    id: row.id,
    ownerId: row.owner_id,
    authorizationId: row.authorization_id,
    createdAt: iso(row.created_at),
  });

const attachmentOf = (row: AttachmentRow) =>
  attachmentCodec.read({
    id: row.id,
    ownerId: row.owner_id,
    connectionId: row.connection_id,
    domain: row.domain,
    zone: row.zone,
    label: row.label,
    target: fromJson(row.target),
    createdAt: iso(row.created_at),
  });

const continuationOf = (row: ContinuationRow) =>
  continuationCodec.read({
    id: row.id,
    ownerId: row.owner_id,
    actorId: row.actor_id,
    provider: row.provider,
    payload: fromJson(row.payload),
    returnTo: row.return_to,
    expiresAt: iso(row.expires_at),
  });

type ContinuationHeaderRow = Pick<
  ContinuationRow,
  "owner_id" | "actor_id" | "provider" | "expires_at"
>;

const continuationHeaderOf = (row: ContinuationHeaderRow) =>
  continuationHeaderCodec.read({
    ownerId: row.owner_id,
    actorId: row.actor_id,
    provider: row.provider,
    expiresAt: iso(row.expires_at),
  });

const attemptOf = (row: AttemptRow) =>
  attemptCodec.read({
    id: row.id,
    ownerId: row.owner_id,
    attachmentId: row.attachment_id,
    kind: row.kind,
    status: row.status,
    plan: fromJson(row.plan),
    approval: fromJsonOrNull(row.approval),
    receipt: fromJsonOrNull(row.receipt),
    rejection: fromJsonOrNull(row.rejection),
    sourceReceiptId: row.source_receipt_id,
    leaseExpiresAt: isoOrNull(row.lease_expires_at),
    failure: row.failure,
    updatedAt: iso(row.updated_at),
  });

const batchOf = (row: BatchRow) =>
  batchCodec.read({
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    status: row.status,
    digest: row.digest,
    approval: fromJsonOrNull(row.approval),
    rejection: fromJsonOrNull(row.rejection),
    idempotencyKey: row.idempotency_key,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: isoOrNull(row.completed_at),
  });

const batchItemOf = (row: BatchItemRow) =>
  batchItemCodec.read({
    batchId: row.batch_id,
    attachmentId: row.attachment_id,
    position: row.position,
    attemptId: row.attempt_id,
    planFailure: row.plan_failure,
  });

const readinessOf = (row: ReadinessRow) =>
  readinessCodec.read({
    domain: row.domain,
    attachmentId: row.attachment_id,
    ownerId: row.owner_id,
    overall: row.overall,
    requirements: fromJson(row.requirements),
    host: fromJson(row.host),
    pendingSince: isoOrNull(row.pending_since),
    checkedAt: iso(row.checked_at),
    nextCheckAt: isoOrNull(row.next_check_at),
  });

const stale = (attempt: Storage.Attempt) =>
  fail(new Reason.Stale({ planId: attempt.id, digest: attempt.plan.digest }));

const batchStale = (batch: Storage.Batch) =>
  fail(new Reason.BatchStale({ batchId: batch.id, status: batch.status, digest: batch.digest }));

/** `prefix_<uuid>`, the same identifier shape the memory implementation mints. */
const fresh = (prefix: string) => Effect.sync(() => `${prefix}_${crypto.randomUUID()}`);

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export const make = (
  tables: Tables,
): Effect.Effect<Storage.Interface, never, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // A host may configure result-name transforms for its own tables; these queries read the exact
    // snake_case columns the capsule declared.
    const sql = client.withoutTransforms();

    const authorizations = sql(tables.authorizations.name);
    const connections = sql(tables.connections.name);
    const attachments = sql(tables.attachments.name);
    const continuations = sql(tables.continuations.name);
    const attempts = sql(tables.attempts.name);
    const readiness = sql(tables.readiness.name);
    const batches = sql(tables.batches.name);
    const batchItems = sql(tables.batchItems.name);

    /** The row this principal owns, locked for the rest of the transaction. */
    const lockedAuthorization = (owner: string, id: string) =>
      sql<AuthorizationRow>`
        SELECT * FROM ${authorizations} WHERE id = ${id} AND owner_id = ${owner} FOR UPDATE
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? notFound("authorization", id) : Effect.succeed(rows[0]),
        ),
      );

    const lockedAttempt = (owner: string, id: string) =>
      sql<AttemptRow>`
        SELECT * FROM ${attempts} WHERE id = ${id} AND owner_id = ${owner} FOR UPDATE
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? notFound("plan", id) : Effect.succeed(rows[0]),
        ),
        Effect.flatMap(attemptOf),
      );

    const requireConnection = (owner: string, id: string) =>
      sql<ConnectionRow>`
        SELECT * FROM ${connections} WHERE id = ${id} AND owner_id = ${owner}
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? notFound("connection", id) : Effect.succeed(rows[0]),
        ),
      );

    const requireAttachment = (owner: string, id: string) =>
      sql<AttachmentRow>`
        SELECT * FROM ${attachments} WHERE id = ${id} AND owner_id = ${owner}
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? notFound("attachment", id) : Effect.succeed(rows[0]),
        ),
      );

    const writeAuthorization = (
      authorization: Storage.Authorization,
      credential: Storage.Credential,
    ) =>
      Effect.all({
        row: authorizationCodec.write(authorization),
        secret: credentialCodec.write(credential),
      });

    /**
     * Phase one of revocation: mark the row `pending` so a crash between the provider call and the
     * delete is recoverable. Idempotent, and it never widens the row's state.
     *
     * Returns the ciphertext the caller is about to have revoked, which phase two checks.
     */
    const prepareRevocation = (owner: string, id: string) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const row = yield* lockedAuthorization(owner, id);
          yield* sql`
            UPDATE ${authorizations} SET revocation = 'pending', updated_at = ${yield* now}
            WHERE id = ${id} AND owner_id = ${owner}
          `;
          return row.credential_ciphertext;
        }),
      );

    /**
     * Phase two: delete the row, but only while it still holds the credential the provider was
     * asked to revoke.
     *
     * A credential refresh runs concurrently with revocation and rotates the row after the provider
     * call selected the old ciphertext. Deleting unconditionally would drop the row while the newly
     * issued credential is still live at the provider, with no local state left to revoke it from.
     * Leaving the row `pending` instead hands it to `recoverRevocations`, which revokes what the
     * row now holds. Every ciphertext is AES-GCM with a fresh IV, so equality here is exact.
     */
    const completeRevocation = (owner: string, id: string, ciphertext: string) =>
      sql`
        DELETE FROM ${authorizations}
        WHERE id = ${id} AND owner_id = ${owner} AND credential_ciphertext = ${ciphertext}
      `;

    const requireBatch = (owner: string, id: string) =>
      sql<BatchRow>`
        SELECT * FROM ${batches} WHERE id = ${id} AND owner_id = ${owner}
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? notFound("batch", id) : Effect.succeed(rows[0]),
        ),
        Effect.flatMap(batchOf),
      );

    /** The batch this principal owns, locked for the rest of the transaction. */
    const lockedBatch = (owner: string, id: string) =>
      sql<BatchRow>`
        SELECT * FROM ${batches} WHERE id = ${id} AND owner_id = ${owner} FOR UPDATE
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? notFound("batch", id) : Effect.succeed(rows[0]),
        ),
        Effect.flatMap(batchOf),
      );

    const requireAttempt = (owner: string, id: string) =>
      sql<AttemptRow>`
        SELECT * FROM ${attempts} WHERE id = ${id} AND owner_id = ${owner}
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? notFound("plan", id) : Effect.succeed(rows[0]),
        ),
      );

    /**
     * A batch's items in `position` order, each with its attempt's status, which is what the
     * aggregate's own status is recomputed from. The batch was already read under its owner, and
     * the join carries the same filter so an item can only ever reach that owner's attempts.
     */
    const itemRows = (owner: string, batchId: string) =>
      sql<BatchItemStatusRow>`
        SELECT item.batch_id, item.attachment_id, item."position", item.attempt_id,
               item.plan_failure, attempt.status AS attempt_status
        FROM ${batchItems} AS item
        LEFT JOIN ${attempts} AS attempt
          ON attempt.id = item.attempt_id AND attempt.owner_id = ${owner}
        WHERE item.batch_id = ${batchId}
        ORDER BY item."position" ASC
      `;

    const aggregateOf = (
      owner: string,
      batch: Storage.Batch,
    ): Effect.Effect<Storage.BatchAggregate, Fail | SqlError.SqlError> =>
      itemRows(owner, batch.id).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, batchItemOf)),
        Effect.map((items) => ({ batch, items })),
      );

    /**
     * Write `batch` with its status recomputed from the items' attempts.
     *
     * Every transition ends here, inside the transaction that locked the row, so the stored status
     * and the owner-scoped unfinished index never disagree with the attempts they summarize.
     */
    const settled = (
      owner: string,
      batch: Storage.Batch,
    ): Effect.Effect<Storage.BatchAggregate, Fail | SqlError.SqlError> =>
      Effect.gen(function* () {
        const rows = yield* itemRows(owner, batch.id);
        const items = yield* Effect.forEach(rows, batchItemOf);
        const status = Storage.batchStatusOf({
          approved: batch.approval !== null,
          rejected: batch.rejection !== null,
          items: rows.map((row) =>
            row.attempt_id === null ? null : (row.attempt_status as Storage.AttemptStatus | null),
          ),
        });
        const instant = yield* DateTime.now;
        const next = new Storage.Batch({
          ...batch,
          status,
          completedAt: status === "complete" || status === "rejected" ? instant : null,
          updatedAt: instant,
        });
        const encoded = yield* batchCodec.write(next);
        yield* sql`
          UPDATE ${batches} SET
            status = ${encoded.status},
            digest = ${encoded.digest},
            approval = ${toJsonOrNull(encoded.approval)},
            rejection = ${toJsonOrNull(encoded.rejection)},
            completed_at = ${atOrNull(encoded.completedAt)},
            updated_at = ${at(encoded.updatedAt)}
          WHERE id = ${batch.id} AND owner_id = ${owner}
        `;
        return { batch: next, items };
      });

    const service: Storage.Interface = {
      authorizations: {
        upsert: ({ authorization, credential, expectedId }) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              if (authorization.ownerId !== ownerId) {
                return yield* invalid(
                  "Authorization owner does not match the principal",
                  "ownerId",
                );
              }
              const { row, secret } = yield* writeAuthorization(authorization, credential);
              const stamp = yield* now;
              return yield* sql.withTransaction(
                Effect.gen(function* () {
                  if (expectedId !== undefined) {
                    const current = yield* lockedAuthorization(ownerId, expectedId);
                    if (current.revocation !== "active") {
                      return yield* busy(`authorization:${expectedId}`);
                    }
                    if (authorization.id !== expectedId) {
                      return yield* invalid("Authorization id must match expectedId", "id");
                    }
                    // A replace overwrites every column the caller supplied, including `created_at`:
                    // the row it returns has to be the row a later `get` reads back.
                    yield* sql`
                      UPDATE ${authorizations} SET
                        provider = ${row.provider},
                        method = ${row.method},
                        capabilities = ${toJson(row.capabilities)},
                        context = ${toJson(row.context)},
                        label = ${row.label},
                        revocation = ${row.revocation},
                        created_by = ${row.createdBy},
                        created_at = ${at(row.createdAt)},
                        credential_ciphertext = ${secret.ciphertext},
                        credential_expires_at = ${atOrNull(secret.expiresAt)},
                        credential_rotated_at = ${at(secret.rotatedAt)},
                        updated_at = ${stamp}
                      WHERE id = ${expectedId} AND owner_id = ${ownerId}
                    `;
                    return authorization;
                  }
                  // An id already taken by any tenant is a caller defect, not a missing row, so the
                  // insert claims it atomically instead of racing a prior existence check.
                  const inserted = yield* sql<{ readonly id: string }>`
                    INSERT INTO ${authorizations} (
                      id, owner_id, provider, method, capabilities, context, label, revocation,
                      created_by, created_at, credential_ciphertext, credential_expires_at,
                      credential_rotated_at, updated_at
                    ) VALUES (
                      ${row.id}, ${row.ownerId}, ${row.provider}, ${row.method},
                      ${toJson(row.capabilities)}, ${toJson(row.context)}, ${row.label},
                      ${row.revocation},
                      ${row.createdBy}, ${at(row.createdAt)}, ${secret.ciphertext},
                      ${atOrNull(secret.expiresAt)}, ${at(secret.rotatedAt)}, ${stamp}
                    ) ON CONFLICT (id) DO NOTHING RETURNING id
                  `;
                  return inserted[0] === undefined
                    ? yield* invalid(`Authorization ${authorization.id} already exists`, "id")
                    : authorization;
                }),
              );
            }),
          ).pipe(guard("authorizations.upsert")),
        get: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<AuthorizationRow>`
              SELECT * FROM ${authorizations} WHERE id = ${id} AND owner_id = ${ownerId}
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined ? notFound("authorization", id) : authorizationOf(rows[0]),
              ),
            ),
          ).pipe(guard("authorizations.get")),
        credential: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<AuthorizationRow>`
              SELECT * FROM ${authorizations} WHERE id = ${id} AND owner_id = ${ownerId}
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined ? notFound("authorization", id) : credentialOf(rows[0]),
              ),
            ),
          ).pipe(guard("authorizations.credential")),
        rotate: (id, credential) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              const secret = yield* credentialCodec.write(credential);
              const updated = yield* sql<{ readonly id: string }>`
                UPDATE ${authorizations} SET
                  credential_ciphertext = ${secret.ciphertext},
                  credential_expires_at = ${atOrNull(secret.expiresAt)},
                  credential_rotated_at = ${at(secret.rotatedAt)},
                  updated_at = ${yield* now}
                WHERE id = ${id} AND owner_id = ${ownerId} RETURNING id
              `;
              if (updated[0] === undefined) return yield* notFound("authorization", id);
            }),
          ).pipe(guard("authorizations.rotate")),
        promoteCapabilities: (id, capabilities) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const current = yield* authorizationOf(yield* lockedAuthorization(ownerId, id));
                const merged = [...new Set([...current.capabilities, ...capabilities])];
                yield* sql`
                  UPDATE ${authorizations}
                  SET capabilities = ${toJson(merged)}, updated_at = ${yield* now}
                  WHERE id = ${id} AND owner_id = ${ownerId}
                `;
              }),
            ),
          ).pipe(guard("authorizations.promoteCapabilities")),
        revoke: (id, revoke) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              const ciphertext = yield* prepareRevocation(ownerId, id).pipe(
                guard("authorizations.revoke"),
              );
              yield* revoke;
              yield* completeRevocation(ownerId, id, ciphertext).pipe(
                guard("authorizations.completeRevocation"),
              );
            }),
          ),
        recoverRevocations: (revoke) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              const rows = yield* sql<AuthorizationRow>`
                SELECT * FROM ${authorizations}
                WHERE owner_id = ${ownerId} AND revocation = 'pending'
                ORDER BY created_at
              `.pipe(guard("authorizations.pendingRevocations"));
              yield* Effect.forEach(rows, (row) =>
                Effect.gen(function* () {
                  yield* revoke(yield* authorizationOf(row));
                  yield* completeRevocation(ownerId, row.id, row.credential_ciphertext).pipe(
                    guard("authorizations.completeRevocation"),
                  );
                }),
              );
              return rows.length;
            }),
          ),
      },
      connections: {
        create: (authorizationId) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                yield* lockedAuthorization(ownerId, authorizationId);
                const row = new Storage.Connection({
                  id: yield* fresh("conn"),
                  ownerId,
                  authorizationId,
                  createdAt: yield* DateTime.now,
                });
                const encoded = yield* connectionCodec.write(row);
                yield* sql`
                  INSERT INTO ${connections} (id, owner_id, authorization_id, created_at)
                  VALUES (${encoded.id}, ${encoded.ownerId}, ${encoded.authorizationId},
                          ${at(encoded.createdAt)})
                `;
                return row;
              }),
            ),
          ).pipe(guard("connections.create")),
        get: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.flatMap(requireConnection(ownerId, id), connectionOf),
          ).pipe(guard("connections.get")),
        list: (filter) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.flatMap(
              filter?.provider === undefined
                ? sql<ConnectionRow>`
                    SELECT * FROM ${connections} WHERE owner_id = ${ownerId} ORDER BY created_at
                  `
                : sql<ConnectionRow>`
                    SELECT c.* FROM ${connections} AS c
                    JOIN ${authorizations} AS a ON a.id = c.authorization_id
                    WHERE c.owner_id = ${ownerId} AND a.provider = ${filter.provider}
                    ORDER BY c.created_at
                  `,
              (rows) => Effect.forEach(rows, connectionOf),
            ),
          ).pipe(guard("connections.list")),
        remove: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const rows = yield* sql<ConnectionRow>`
                  SELECT * FROM ${connections}
                  WHERE id = ${id} AND owner_id = ${ownerId} FOR UPDATE
                `;
                if (rows[0] === undefined) return yield* notFound("connection", id);
                const held = yield* sql<{ readonly id: string }>`
                  SELECT id FROM ${attachments}
                  WHERE connection_id = ${id} AND owner_id = ${ownerId} LIMIT 1
                `;
                if (held[0] !== undefined) {
                  return yield* invalid(`Connection ${id} still has attachments`, "connectionId");
                }
                yield* sql`DELETE FROM ${connections} WHERE id = ${id} AND owner_id = ${ownerId}`;
              }),
            ),
          ).pipe(guard("connections.remove")),
      },
      attachments: {
        create: (input) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                yield* requireConnection(ownerId, input.connectionId);
                const row = new Storage.Attachment({
                  id: yield* fresh("att"),
                  ownerId,
                  connectionId: input.connectionId,
                  domain: input.domain,
                  zone: input.zone,
                  label: input.label,
                  target: input.target,
                  createdAt: yield* DateTime.now,
                });
                const encoded = yield* attachmentCodec.write(row);
                // The unique (owner_id, domain) constraint decides the duplicate, so two concurrent
                // attaches cannot both win.
                const inserted = yield* sql<{ readonly id: string }>`
                  INSERT INTO ${attachments} (
                    id, owner_id, connection_id, domain, zone, label, target, created_at
                  ) VALUES (
                    ${encoded.id}, ${encoded.ownerId}, ${encoded.connectionId}, ${encoded.domain},
                    ${encoded.zone}, ${encoded.label}, ${toJson(encoded.target)},
                    ${at(encoded.createdAt)}
                  ) ON CONFLICT (owner_id, domain) DO NOTHING RETURNING id
                `;
                return inserted[0] === undefined
                  ? yield* invalid(`${input.domain} is already attached`, "domain")
                  : row;
              }),
            ),
          ).pipe(guard("attachments.create")),
        get: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.flatMap(requireAttachment(ownerId, id), attachmentOf),
          ).pipe(guard("attachments.get")),
        byDomain: (domain) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<AttachmentRow>`
              SELECT * FROM ${attachments} WHERE owner_id = ${ownerId} AND domain = ${domain}
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined
                  ? Effect.succeedNone
                  : Effect.map(attachmentOf(rows[0]), Option.some),
              ),
            ),
          ).pipe(guard("attachments.byDomain")),
        list: (connectionId) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              yield* requireConnection(ownerId, connectionId);
              const rows = yield* sql<AttachmentRow>`
                SELECT * FROM ${attachments}
                WHERE owner_id = ${ownerId} AND connection_id = ${connectionId}
                ORDER BY created_at
              `;
              return yield* Effect.forEach(rows, attachmentOf);
            }),
          ).pipe(guard("attachments.list")),
        remove: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                yield* requireAttachment(ownerId, id);
                // Readiness is keyed by domain and outlives the attachment, so clear the link
                // rather than the row: what was observed about the domain is still true, and a
                // dangling attachment id would fail the next `readiness.put`.
                yield* sql`
                  UPDATE ${readiness} SET attachment_id = NULL
                  WHERE attachment_id = ${id} AND owner_id = ${ownerId}
                `;
                yield* sql`DELETE FROM ${attachments} WHERE id = ${id} AND owner_id = ${ownerId}`;
              }),
            ),
          ).pipe(guard("attachments.remove")),
      },
      continuations: {
        put: (continuation) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              if (continuation.ownerId !== ownerId) {
                return yield* invalid("Continuation owner does not match the principal", "ownerId");
              }
              const encoded = yield* continuationCodec.write(continuation);
              yield* sql`
                INSERT INTO ${continuations} (
                  id, owner_id, actor_id, provider, payload, return_to, expires_at
                ) VALUES (
                  ${encoded.id}, ${encoded.ownerId}, ${encoded.actorId}, ${encoded.provider},
                  ${toJson(encoded.payload)}, ${encoded.returnTo}, ${at(encoded.expiresAt)}
                ) ON CONFLICT (id) DO UPDATE SET
                  owner_id = EXCLUDED.owner_id,
                  actor_id = EXCLUDED.actor_id,
                  provider = EXCLUDED.provider,
                  payload = EXCLUDED.payload,
                  return_to = EXCLUDED.return_to,
                  expires_at = EXCLUDED.expires_at
              `;
            }),
          ).pipe(guard("continuations.put")),
        get: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              // A read, not a claim: the row survives so `consume` can still spend it.
              const rows = yield* sql<ContinuationRow>`
                SELECT * FROM ${continuations} WHERE id = ${id} AND owner_id = ${ownerId}
              `;
              if (rows[0] === undefined) return yield* notFound("continuation", id);
              const continuation = yield* continuationOf(rows[0]);
              const instant = yield* DateTime.now;
              return DateTime.toEpochMillis(continuation.expiresAt) <=
                DateTime.toEpochMillis(instant)
                ? yield* fail(new Reason.Expired({ entity: "continuation", id }))
                : continuation;
            }),
          ).pipe(guard("continuations.get")),
        header: (id) =>
          Effect.gen(function* () {
            // No owner filter, unlike everything else in this module: the provider callback has to
            // learn whose flow it is finishing before it can resolve a principal to scope by. The
            // projection is the enforcement — `payload` is never selected, so the PKCE verifier
            // stays behind the owner-scoped `get`.
            const rows = yield* sql<ContinuationHeaderRow>`
              SELECT owner_id, actor_id, provider, expires_at
              FROM ${continuations} WHERE id = ${id}
            `;
            if (rows[0] === undefined) return yield* notFound("continuation", id);
            const header = yield* continuationHeaderOf(rows[0]);
            const instant = yield* DateTime.now;
            return DateTime.toEpochMillis(header.expiresAt) <= DateTime.toEpochMillis(instant)
              ? yield* fail(new Reason.Expired({ entity: "continuation", id }))
              : header;
          }).pipe(guard("continuations.header")),
        consume: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              // The delete is the claim: a second consume finds nothing, expired or not.
              const rows = yield* sql<ContinuationRow>`
                DELETE FROM ${continuations}
                WHERE id = ${id} AND owner_id = ${ownerId} RETURNING *
              `;
              if (rows[0] === undefined) return yield* notFound("continuation", id);
              const continuation = yield* continuationOf(rows[0]);
              const instant = yield* DateTime.now;
              return DateTime.toEpochMillis(continuation.expiresAt) <=
                DateTime.toEpochMillis(instant)
                ? yield* fail(new Reason.Expired({ entity: "continuation", id }))
                : continuation;
            }),
          ).pipe(guard("continuations.consume")),
      },
      attempts: {
        create: (attempt) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              if (attempt.ownerId !== ownerId) {
                return yield* invalid("Attempt owner does not match the principal", "ownerId");
              }
              const encoded = yield* attemptCodec.write(attempt);
              const inserted = yield* sql<{ readonly id: string }>`
                INSERT INTO ${attempts} (
                  id, owner_id, attachment_id, kind, status, plan, approval, approval_id,
                  receipt, receipt_id, rejection, source_receipt_id, lease_expires_at, failure,
                  plan_created_at, updated_at
                ) VALUES (
                  ${encoded.id}, ${encoded.ownerId}, ${encoded.attachmentId}, ${encoded.kind},
                  ${encoded.status}, ${toJson(encoded.plan)}, ${toJsonOrNull(encoded.approval)},
                  ${attempt.approval?.id ?? null}, ${toJsonOrNull(encoded.receipt)},
                  ${attempt.receipt?.id ?? null}, ${toJsonOrNull(encoded.rejection)},
                  ${encoded.sourceReceiptId},
                  ${atOrNull(encoded.leaseExpiresAt)}, ${encoded.failure},
                  ${at(encoded.plan.createdAt)}, ${at(encoded.updatedAt)}
                ) ON CONFLICT (id) DO NOTHING RETURNING id
              `;
              return inserted[0] === undefined
                ? yield* invalid(`Plan ${attempt.id} already exists`, "id")
                : attempt;
            }),
          ).pipe(guard("attempts.create")),
        get: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<AttemptRow>`
              SELECT * FROM ${attempts} WHERE id = ${id} AND owner_id = ${ownerId}
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined ? notFound("plan", id) : attemptOf(rows[0]),
              ),
            ),
          ).pipe(guard("attempts.get")),
        byApproval: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<AttemptRow>`
              SELECT * FROM ${attempts} WHERE approval_id = ${id} AND owner_id = ${ownerId}
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined ? notFound("approval", id) : attemptOf(rows[0]),
              ),
            ),
          ).pipe(guard("attempts.byApproval")),
        byReceipt: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<AttemptRow>`
              SELECT * FROM ${attempts} WHERE receipt_id = ${id} AND owner_id = ${ownerId}
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined ? notFound("receipt", id) : attemptOf(rows[0]),
              ),
            ),
          ).pipe(guard("attempts.byReceipt")),
        latest: (attachmentId, kind) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<AttemptRow>`
              SELECT * FROM ${attempts}
              WHERE owner_id = ${ownerId} AND attachment_id = ${attachmentId} AND kind = ${kind}
              ORDER BY plan_created_at DESC, updated_at DESC LIMIT 1
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined
                  ? Effect.succeedNone
                  : Effect.map(attemptOf(rows[0]), Option.some),
              ),
            ),
          ).pipe(guard("attempts.latest")),
        approve: (id, approval) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const current = yield* lockedAttempt(ownerId, id);
                // Replaying the same approval is how a retried request stays safe.
                if (current.approval?.id === approval.id) return current;
                if (current.status !== "planned") return yield* stale(current);
                const next = new Storage.Attempt({
                  ...current,
                  status: "approved",
                  approval,
                  updatedAt: yield* DateTime.now,
                });
                const encoded = yield* attemptCodec.write(next);
                yield* sql`
                  UPDATE ${attempts} SET
                    status = ${encoded.status},
                    approval = ${toJsonOrNull(encoded.approval)},
                    approval_id = ${approval.id},
                    updated_at = ${at(encoded.updatedAt)}
                  WHERE id = ${id} AND owner_id = ${ownerId}
                `;
                return next;
              }),
            ),
          ).pipe(guard("attempts.approve")),
        reject: (id, input) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const current = yield* lockedAttempt(ownerId, id);
                // Terminal: a second rejection is the same outcome, so it returns the first one.
                if (current.status === "rejected") return current;
                if (current.status === "expired") {
                  return yield* fail(new Reason.Expired({ entity: "plan", id }));
                }
                // A digest mismatch means the reviewer declined a plan that is no longer current.
                if (current.status !== "planned" || current.plan.digest !== input.digest) {
                  return yield* stale(current);
                }
                const instant = yield* DateTime.now;
                const next = new Storage.Attempt({
                  ...current,
                  status: "rejected",
                  rejection: { actorId: input.actorId, reason: input.reason, at: instant },
                  updatedAt: instant,
                });
                const encoded = yield* attemptCodec.write(next);
                yield* sql`
                  UPDATE ${attempts} SET
                    status = ${encoded.status},
                    rejection = ${toJsonOrNull(encoded.rejection)},
                    updated_at = ${at(encoded.updatedAt)}
                  WHERE id = ${id} AND owner_id = ${ownerId}
                `;
                return next;
              }),
            ),
          ).pipe(guard("attempts.reject")),
        claim: (id, lease) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const current = yield* lockedAttempt(ownerId, id);
                const instant = yield* DateTime.now;
                if (current.status === "applying") {
                  const held =
                    current.leaseExpiresAt !== null &&
                    DateTime.toEpochMillis(current.leaseExpiresAt) >
                      DateTime.toEpochMillis(instant);
                  if (held) return yield* busy(`apply:${id}`);
                } else if (current.status !== "approved" && current.status !== "failed") {
                  return yield* stale(current);
                }
                const next = new Storage.Attempt({
                  ...current,
                  status: "applying",
                  leaseExpiresAt: lease,
                  failure: null,
                  updatedAt: instant,
                });
                const encoded = yield* attemptCodec.write(next);
                yield* sql`
                  UPDATE ${attempts} SET
                    status = ${encoded.status},
                    lease_expires_at = ${atOrNull(encoded.leaseExpiresAt)},
                    failure = NULL,
                    updated_at = ${at(encoded.updatedAt)}
                  WHERE id = ${id} AND owner_id = ${ownerId}
                `;
                return next;
              }),
            ),
          ).pipe(guard("attempts.claim")),
        complete: (id, receipt) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const current = yield* lockedAttempt(ownerId, id);
                if (current.status !== "applying") return yield* stale(current);
                const next = new Storage.Attempt({
                  ...current,
                  status: receipt.status,
                  receipt,
                  leaseExpiresAt: null,
                  updatedAt: yield* DateTime.now,
                });
                const encoded = yield* attemptCodec.write(next);
                yield* sql`
                  UPDATE ${attempts} SET
                    status = ${encoded.status},
                    receipt = ${toJsonOrNull(encoded.receipt)},
                    receipt_id = ${receipt.id},
                    lease_expires_at = NULL,
                    updated_at = ${at(encoded.updatedAt)}
                  WHERE id = ${id} AND owner_id = ${ownerId}
                `;
                return next;
              }),
            ),
          ).pipe(guard("attempts.complete")),
        fail: (id, message) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const current = yield* lockedAttempt(ownerId, id);
                if (current.status !== "applying") return yield* stale(current);
                const next = new Storage.Attempt({
                  ...current,
                  status: "failed",
                  failure: message,
                  leaseExpiresAt: null,
                  updatedAt: yield* DateTime.now,
                });
                const encoded = yield* attemptCodec.write(next);
                yield* sql`
                  UPDATE ${attempts} SET
                    status = ${encoded.status},
                    failure = ${message},
                    lease_expires_at = NULL,
                    updated_at = ${at(encoded.updatedAt)}
                  WHERE id = ${id} AND owner_id = ${ownerId}
                `;
                return next;
              }),
            ),
          ).pipe(guard("attempts.fail")),
      },
      batches: {
        create: (input) =>
          Effect.flatMap(Principal.Service, ({ actorId, ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const replayed = (row: BatchRow) =>
                  Effect.flatMap(batchOf(row), (batch) => aggregateOf(ownerId, batch));
                const existing = yield* sql<BatchRow>`
                  SELECT * FROM ${batches}
                  WHERE owner_id = ${ownerId} AND idempotency_key = ${input.idempotencyKey}
                `;
                // A retried create is the same batch, whatever the second call asks for.
                if (existing[0] !== undefined) return yield* replayed(existing[0]);
                if (input.attachmentIds.length === 0) {
                  return yield* invalid("A batch needs at least one attachment", "attachmentIds");
                }
                if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
                  return yield* invalid("A batch holds one item per attachment", "attachmentIds");
                }
                for (const attachmentId of input.attachmentIds) {
                  yield* requireAttachment(ownerId, attachmentId);
                }
                const instant = yield* DateTime.now;
                const batch = new Storage.Batch({
                  id: Storage.BatchId.make(yield* fresh("batch")),
                  ownerId,
                  kind: input.kind,
                  status: "planning",
                  digest: null,
                  approval: null,
                  rejection: null,
                  idempotencyKey: input.idempotencyKey,
                  createdBy: actorId,
                  createdAt: instant,
                  updatedAt: instant,
                  completedAt: null,
                });
                const encoded = yield* batchCodec.write(batch);
                // The unique key decides the race rather than the read above: a concurrent create
                // under the same key loses the insert and reads the batch it lost to.
                const inserted = yield* sql<{ readonly id: string }>`
                  INSERT INTO ${batches} (
                    id, owner_id, kind, status, digest, approval, rejection, idempotency_key,
                    created_by, created_at, updated_at, completed_at
                  ) VALUES (
                    ${encoded.id}, ${encoded.ownerId}, ${encoded.kind}, ${encoded.status},
                    ${encoded.digest}, ${toJsonOrNull(encoded.approval)},
                    ${toJsonOrNull(encoded.rejection)}, ${encoded.idempotencyKey},
                    ${encoded.createdBy}, ${at(encoded.createdAt)}, ${at(encoded.updatedAt)},
                    ${atOrNull(encoded.completedAt)}
                  ) ON CONFLICT (owner_id, idempotency_key) DO NOTHING RETURNING id
                `;
                if (inserted[0] === undefined) {
                  const winner = yield* sql<BatchRow>`
                    SELECT * FROM ${batches}
                    WHERE owner_id = ${ownerId} AND idempotency_key = ${input.idempotencyKey}
                  `;
                  return winner[0] === undefined
                    ? yield* notFound("batch", input.idempotencyKey)
                    : yield* replayed(winner[0]);
                }
                const items = input.attachmentIds.map(
                  (attachmentId, position) =>
                    new Storage.BatchItem({
                      batchId: batch.id,
                      attachmentId,
                      position,
                      attemptId: null,
                      planFailure: null,
                    }),
                );
                for (const item of items) {
                  yield* sql`
                    INSERT INTO ${batchItems} (
                      batch_id, attachment_id, "position", attempt_id, plan_failure
                    ) VALUES (
                      ${item.batchId}, ${item.attachmentId}, ${item.position}, ${item.attemptId},
                      ${item.planFailure}
                    )
                  `;
                }
                return { batch, items };
              }),
            ),
          ).pipe(guard("batches.create")),
        get: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.flatMap(requireBatch(ownerId, id), (batch) => aggregateOf(ownerId, batch)),
          ).pipe(guard("batches.get")),
        byIdempotencyKey: (key) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<BatchRow>`
              SELECT * FROM ${batches}
              WHERE owner_id = ${ownerId} AND idempotency_key = ${key}
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined
                  ? Effect.succeedNone
                  : Effect.flatMap(batchOf(rows[0]), (batch) =>
                      Effect.map(aggregateOf(ownerId, batch), Option.some),
                    ),
              ),
            ),
          ).pipe(guard("batches.byIdempotencyKey")),
        listUnfinished: () =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              const rows = yield* sql<BatchRow>`
                SELECT * FROM ${batches}
                WHERE owner_id = ${ownerId} AND status NOT IN ('complete', 'rejected')
                ORDER BY updated_at DESC
              `;
              if (rows.length === 0) return [];
              const list = yield* Effect.forEach(rows, batchOf);
              // Items are pointers, so the whole index is two queries: no attempt is read here.
              const itemsRows = yield* sql<BatchItemRow>`
                SELECT batch_id, attachment_id, "position", attempt_id, plan_failure
                FROM ${batchItems}
                WHERE ${sql.in(
                  "batch_id",
                  list.map(({ id }) => id),
                )}
                ORDER BY "position" ASC
              `;
              const items = yield* Effect.forEach(itemsRows, batchItemOf);
              return list.map((batch) => ({
                batch,
                items: items.filter((item) => item.batchId === batch.id),
              }));
            }),
          ).pipe(guard("batches.listUnfinished")),
        recordItemPlan: (id, attachmentId, attemptId) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const batch = yield* lockedBatch(ownerId, id);
                // The fence: a planning pass still in flight must not land state on a batch the
                // principal declined, or on one already bound to an approved digest.
                if (batch.status !== "planning" && batch.status !== "planned") {
                  return yield* batchStale(batch);
                }
                const attempt = yield* requireAttempt(ownerId, attemptId);
                if (attempt.attachment_id !== attachmentId || attempt.kind !== batch.kind) {
                  return yield* invalid(
                    `Plan ${attemptId} does not belong to attachment ${attachmentId} in this batch`,
                    "attemptId",
                  );
                }
                const updated = yield* sql<{ readonly attachment_id: string }>`
                  UPDATE ${batchItems} SET attempt_id = ${attemptId}, plan_failure = NULL
                  WHERE batch_id = ${id} AND attachment_id = ${attachmentId}
                  RETURNING attachment_id
                `;
                return updated[0] === undefined
                  ? yield* notFound("attachment", attachmentId)
                  : yield* settled(ownerId, batch);
              }),
            ),
          ).pipe(guard("batches.recordItemPlan")),
        recordItemPlanFailure: (id, attachmentId, message) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const batch = yield* lockedBatch(ownerId, id);
                if (batch.status !== "planning" && batch.status !== "planned") {
                  return yield* batchStale(batch);
                }
                const updated = yield* sql<{ readonly attachment_id: string }>`
                  UPDATE ${batchItems} SET attempt_id = NULL, plan_failure = ${message}
                  WHERE batch_id = ${id} AND attachment_id = ${attachmentId}
                  RETURNING attachment_id
                `;
                return updated[0] === undefined
                  ? yield* notFound("attachment", attachmentId)
                  : yield* settled(ownerId, batch);
              }),
            ),
          ).pipe(guard("batches.recordItemPlanFailure")),
        approve: (id, input) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const batch = yield* lockedBatch(ownerId, id);
                // Replaying the same approval is how a retried request stays safe.
                if (batch.approval !== null) {
                  return batch.digest === input.digest
                    ? yield* aggregateOf(ownerId, batch)
                    : yield* batchStale(batch);
                }
                if (batch.status !== "planned") return yield* batchStale(batch);
                const items = yield* Effect.forEach(yield* itemRows(ownerId, id), batchItemOf);
                const pairs: Array<{
                  readonly attemptId: Plan.PlanId;
                  readonly approval: Approval.Model;
                }> = [];
                for (const item of items) {
                  const supplied = input.approvals.find(
                    (entry) => entry.attachmentId === item.attachmentId,
                  );
                  if (supplied === undefined) {
                    return yield* invalid(
                      `Batch ${id} has no approval for attachment ${item.attachmentId}`,
                      "approvals",
                    );
                  }
                  // The item has to still point at the attempt this approval names: anything else
                  // means the batch was re-planned after the principal reviewed it.
                  if (item.attemptId === null || item.attemptId !== supplied.approval.planId) {
                    return yield* batchStale(batch);
                  }
                  pairs.push({ attemptId: item.attemptId, approval: supplied.approval });
                }
                const instant = yield* DateTime.now;
                // The per-attempt approvals and the batch's own are one transaction: a batch is
                // never approved without the approvals `attempts.apply` takes.
                for (const pair of pairs) {
                  const current = yield* lockedAttempt(ownerId, pair.attemptId);
                  if (current.approval?.id === pair.approval.id) continue;
                  if (current.status !== "planned") return yield* stale(current);
                  const next = new Storage.Attempt({
                    ...current,
                    status: "approved",
                    approval: pair.approval,
                    updatedAt: instant,
                  });
                  const encoded = yield* attemptCodec.write(next);
                  yield* sql`
                    UPDATE ${attempts} SET
                      status = ${encoded.status},
                      approval = ${toJsonOrNull(encoded.approval)},
                      approval_id = ${pair.approval.id},
                      updated_at = ${at(encoded.updatedAt)}
                    WHERE id = ${pair.attemptId} AND owner_id = ${ownerId}
                  `;
                }
                return yield* settled(
                  ownerId,
                  new Storage.Batch({
                    ...batch,
                    digest: input.digest,
                    approval: { actorId: input.actorId, at: instant },
                  }),
                );
              }),
            ),
          ).pipe(guard("batches.approve")),
        reject: (id, input) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const batch = yield* lockedBatch(ownerId, id);
                // Terminal: a second rejection is the same outcome, so it returns the first one.
                if (batch.rejection !== null) return yield* aggregateOf(ownerId, batch);
                if (batch.status !== "planning" && batch.status !== "planned") {
                  return yield* batchStale(batch);
                }
                const rows = yield* itemRows(ownerId, id);
                const instant = yield* DateTime.now;
                const rejection = {
                  actorId: input.actorId,
                  reason: input.reason,
                  at: instant,
                };
                for (const row of rows) {
                  if (row.attempt_id === null || row.attempt_status !== "planned") continue;
                  const current = yield* lockedAttempt(ownerId, row.attempt_id);
                  if (current.status !== "planned") continue;
                  const next = new Storage.Attempt({
                    ...current,
                    status: "rejected",
                    rejection,
                    updatedAt: instant,
                  });
                  const encoded = yield* attemptCodec.write(next);
                  yield* sql`
                    UPDATE ${attempts} SET
                      status = ${encoded.status},
                      rejection = ${toJsonOrNull(encoded.rejection)},
                      updated_at = ${at(encoded.updatedAt)}
                    WHERE id = ${row.attempt_id} AND owner_id = ${ownerId}
                  `;
                }
                return yield* settled(ownerId, new Storage.Batch({ ...batch, rejection }));
              }),
            ),
          ).pipe(guard("batches.reject")),
        refresh: (id) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql.withTransaction(
              Effect.flatMap(lockedBatch(ownerId, id), (batch) => settled(ownerId, batch)),
            ),
          ).pipe(guard("batches.refresh")),
      },
      readiness: {
        put: (row) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            Effect.gen(function* () {
              if (row.ownerId !== ownerId) {
                return yield* invalid("Readiness owner does not match the principal", "ownerId");
              }
              // A linked attachment has to exist for this owner; observe-only readiness has none.
              if (row.attachmentId !== null) yield* requireAttachment(ownerId, row.attachmentId);
              const encoded = yield* readinessCodec.write(row);
              yield* sql`
                INSERT INTO ${readiness} (
                  owner_id, domain, attachment_id, overall, requirements, host, pending_since,
                  checked_at, next_check_at
                ) VALUES (
                  ${encoded.ownerId}, ${encoded.domain}, ${encoded.attachmentId},
                  ${encoded.overall}, ${toJson(encoded.requirements)}, ${toJson(encoded.host)},
                  ${atOrNull(encoded.pendingSince)}, ${at(encoded.checkedAt)},
                  ${atOrNull(encoded.nextCheckAt)}
                ) ON CONFLICT (owner_id, domain) DO UPDATE SET
                  attachment_id = EXCLUDED.attachment_id,
                  overall = EXCLUDED.overall,
                  requirements = EXCLUDED.requirements,
                  host = EXCLUDED.host,
                  pending_since = EXCLUDED.pending_since,
                  checked_at = EXCLUDED.checked_at,
                  next_check_at = EXCLUDED.next_check_at
              `;
            }),
          ).pipe(guard("readiness.put")),
        get: (domain) =>
          Effect.flatMap(Principal.Service, ({ ownerId }) =>
            sql<ReadinessRow>`
              SELECT * FROM ${readiness}
              WHERE owner_id = ${ownerId} AND domain = ${domain}
            `.pipe(
              Effect.flatMap((rows) =>
                rows[0] === undefined
                  ? Effect.succeedNone
                  : Effect.map(readinessOf(rows[0]), Option.some),
              ),
            ),
          ).pipe(guard("readiness.get")),
      },
      withLock: (key, effect) =>
        Effect.flatMap(Principal.Service, ({ ownerId }) =>
          Effect.scoped(
            Effect.gen(function* () {
              // A session lock, not a transaction lock: the guarded effect refreshes a credential
              // against the provider, and no transaction should stay open across an HTTP call.
              // `reserve` pins one pooled connection so the unlock runs on the session that took
              // the lock, and registering it after the connection makes it run first on release.
              const connection = yield* Effect.mapError(sql.reserve, (error) =>
                storageFailed("withLock", sqlMessage(error)),
              );
              const scoped = `${ownerId}:${key}`;
              yield* Effect.acquireRelease(
                connection
                  .execute(
                    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
                    [scoped],
                    undefined,
                  )
                  .pipe(
                    Effect.mapError((error: SqlError.SqlError) =>
                      storageFailed("withLock", sqlMessage(error)),
                    ),
                    Effect.flatMap((rows: ReadonlyArray<{ readonly acquired: boolean }>) =>
                      rows[0]?.acquired === true ? Effect.void : busy(key),
                    ),
                  ),
                () =>
                  connection
                    .execute(
                      "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
                      [scoped],
                      undefined,
                    )
                    .pipe(Effect.ignore),
              );
              return yield* effect;
            }),
          ),
        ),
    };

    return service;
  });
