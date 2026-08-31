import { makeCapsule, makeMigration, sqlMigrationBody } from "capsuledb";
import { Connection, ManagedDnsConnections } from "domainkit";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";

import * as CredentialCustody from "./custody.ts";
import * as HostBindings from "./host-bindings.ts";

type Authorization = ManagedDnsConnections.Authorization.ProviderAuthorization;
type StoredConnection = typeof ManagedDnsConnections.StoredConnection.Type;
type DomainAttachment = typeof Connection.DomainAttachment.Type;

interface StoredAggregate {
  readonly attachments: ReadonlyArray<DomainAttachment>;
  readonly authorization: Authorization;
  readonly connections: ReadonlyArray<StoredConnection>;
  readonly credentialCiphertext: string;
}

interface AuthorizationRow {
  readonly capability_evidence: unknown;
  readonly capabilities: unknown;
  readonly created_at: Date;
  readonly credential_ciphertext: string | null;
  readonly expires_at: Date | null;
  readonly id: string;
  readonly kind: string;
  readonly provider_context: unknown;
  readonly provider_id: string;
  readonly revocation: unknown;
  readonly scopes: unknown;
  readonly subject_id: string;
}

interface ConnectionRow {
  readonly authorization_id: string;
  readonly created_at: Date;
  readonly id: string;
  readonly organization_id: string;
}

interface AttachmentRow {
  readonly connection_id: string;
  readonly created_at: Date;
  readonly id: string;
  readonly provider_account_id: string;
  readonly provider_target_context: unknown;
  readonly provider_zone_id: string;
  readonly provider_zone_name: string;
}

const AttachmentContext = Schema.Struct({
  version: Schema.Literal("domainkit.attachment.v1"),
  value: Schema.Struct({
    accountKind: Schema.NullOr(Schema.Literals(["account", "personal", "team"])),
    domain: Schema.String,
    evidence: Schema.optionalKey(Connection.ProviderTargetEvidence),
  }),
});

const storageError = (
  operation: string,
  message: string,
  retry: "never" | "after-user-action" | "safe" | "unknown" = "unknown",
) =>
  new ManagedDnsConnections.Error({
    category: "storage",
    message,
    operation,
    retry,
  });

const missing = (operation: string, message: string) => storageError(operation, message, "never");
const conflict = (operation: string, message: string) =>
  storageError(operation, message, "after-user-action");

const sqlErrorMessage = (error: SqlError.SqlError): string =>
  error.reason.cause instanceof Error
    ? `${error.reason._tag}: ${error.reason.cause.message}`
    : `${error.reason._tag}: ${error.reason.message ?? String(error.reason.cause)}`;

const mapCapabilityError = (
  operation: string,
  error: {
    readonly message: string;
    readonly retry: "never" | "after-user-action" | "safe" | "unknown";
  },
) => storageError(operation, error.message, error.retry);

const mapSql = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, SqlError.SqlError> | ManagedDnsConnections.Error, R> =>
  // SAFETY: the runtime guard maps every SqlError and re-fails every other E unchanged.
  Effect.matchEffect(effect, {
    onFailure: (error) => {
      const mapped: E | ManagedDnsConnections.Error = SqlError.isSqlError(error)
        ? storageError(operation, sqlErrorMessage(error), "unknown")
        : error;
      return Effect.fail(mapped);
    },
    onSuccess: Effect.succeed,
  }) as Effect.Effect<A, Exclude<E, SqlError.SqlError> | ManagedDnsConnections.Error, R>;

const sameAttachment = (left: DomainAttachment, right: DomainAttachment): boolean =>
  left.connectionId === right.connectionId &&
  left.domain === right.domain &&
  left.target.accountId === right.target.accountId &&
  left.target.accountKind === right.target.accountKind &&
  left.target.zoneId === right.target.zoneId &&
  left.target.zoneName === right.target.zoneName;

const decodeAuthorization = Effect.fn("CapsuleManagedDnsConnections.decodeAuthorization")(
  function* (row: AuthorizationRow) {
    if (row.credential_ciphertext === null) {
      return yield* Effect.fail(
        missing("decodeAuthorization", `Authorization ${row.id} has no credential ciphertext`),
      );
    }
    const authorization = yield* Schema.decodeUnknownEffect(
      ManagedDnsConnections.Authorization.Schema,
    )({
      authorizedById: row.subject_id,
      capabilityEvidence: row.capability_evidence,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at?.toISOString() ?? null,
      id: row.id,
      method: row.kind,
      providerContext: row.provider_context,
      providerId: row.provider_id,
      requiredCapabilities: row.capabilities,
      revocation: row.revocation,
      scopes: row.scopes,
    }).pipe(
      Effect.mapError((error) =>
        missing("decodeAuthorization", `Authorization ${row.id} is invalid: ${error.message}`),
      ),
    );
    return { authorization, credentialCiphertext: row.credential_ciphertext };
  },
);

const decodeAttachment = Effect.fn("CapsuleManagedDnsConnections.decodeAttachment")(function* (
  row: AttachmentRow,
) {
  const context = yield* Schema.decodeUnknownEffect(AttachmentContext)(
    row.provider_target_context,
  ).pipe(
    Effect.mapError((error) =>
      missing("decodeAttachment", `Attachment ${row.id} context is invalid: ${error.message}`),
    ),
  );
  return yield* Schema.decodeUnknownEffect(Connection.DomainAttachment)({
    connectionId: row.connection_id,
    createdAt: row.created_at.toISOString(),
    domain: context.value.domain,
    id: row.id,
    target: {
      accountId: row.provider_account_id,
      accountKind: context.value.accountKind,
      ...(context.value.evidence === undefined ? {} : { evidence: context.value.evidence }),
      zoneId: row.provider_zone_id,
      zoneName: row.provider_zone_name,
    },
  }).pipe(
    Effect.mapError((error) =>
      missing("decodeAttachment", `Attachment ${row.id} is invalid: ${error.message}`),
    ),
  );
});

const encodeAuthorization = Effect.fn("CapsuleManagedDnsConnections.encodeAuthorization")(
  function* (authorization: Authorization) {
    return yield* Schema.encodeUnknownEffect(ManagedDnsConnections.Authorization.Schema)(
      authorization,
    ).pipe(
      Effect.mapError((error) =>
        conflict("encodeAuthorization", `Authorization cannot be encoded: ${error.message}`),
      ),
    );
  },
);

const loadAggregate = Effect.fn("CapsuleManagedDnsConnections.loadAggregate")(function* (
  sql: SqlClient.SqlClient,
  bindings: HostBindings.Interface,
  authorizationId: string,
  lock: "share" | "update" = "share",
) {
  const lockClause = lock === "update" ? "FOR UPDATE" : "FOR SHARE";
  const authorizationRows = yield* sql.unsafe<AuthorizationRow>(
    `SELECT id, provider_id, subject_id, kind, capabilities, capability_evidence, scopes,
      provider_context, revocation, credential_ciphertext, expires_at, created_at
      FROM domain_provider_authorizations WHERE id = $1 ${lockClause}`,
    [authorizationId],
  );
  const row = authorizationRows[0];
  if (row === undefined) return null;
  const decoded = yield* decodeAuthorization(row);
  const connectionRows = yield* sql<ConnectionRow>`SELECT id, organization_id, authorization_id,
      created_at FROM organization_domain_provider_connections
      WHERE authorization_id = ${authorizationId} ORDER BY id`;
  const connections = yield* Effect.forEach(connectionRows, (connection) =>
    bindings.ownerId(connection.organization_id).pipe(
      Effect.mapError((error) => mapCapabilityError("loadAggregate", error)),
      Effect.map(
        (ownerId) =>
          ({
            authorizationId: connection.authorization_id,
            createdAt: connection.created_at,
            id: connection.id,
            method: decoded.authorization.method,
            ownerId,
            providerId: decoded.authorization.providerId,
          }) satisfies StoredConnection,
      ),
    ),
  );
  const attachmentRows = yield* sql<AttachmentRow>`SELECT a.id, a.connection_id,
      a.provider_account_id, a.provider_zone_id, a.provider_zone_name,
      a.provider_target_context, a.created_at
      FROM domain_provider_attachments a
      JOIN organization_domain_provider_connections c ON c.id = a.connection_id
      WHERE c.authorization_id = ${authorizationId} ORDER BY a.id`;
  const attachments = yield* Effect.forEach(attachmentRows, decodeAttachment);
  return {
    attachments,
    authorization: decoded.authorization,
    connections,
    credentialCiphertext: decoded.credentialCiphertext,
  } satisfies StoredAggregate;
});

const authorizationIdForConnection = Effect.fn(
  "CapsuleManagedDnsConnections.authorizationIdForConnection",
)(function* (sql: SqlClient.SqlClient, connectionId: string) {
  const rows = yield* sql<{ readonly authorization_id: string }>`SELECT authorization_id
    FROM organization_domain_provider_connections WHERE id = ${connectionId}`;
  return rows[0]?.authorization_id ?? null;
});

const authorizationIdForAttachment = Effect.fn(
  "CapsuleManagedDnsConnections.authorizationIdForAttachment",
)(function* (sql: SqlClient.SqlClient, attachmentId: string) {
  const rows = yield* sql<{ readonly authorization_id: string }>`SELECT c.authorization_id
    FROM domain_provider_attachments a
    JOIN organization_domain_provider_connections c ON c.id = a.connection_id
    WHERE a.id = ${attachmentId}`;
  return rows[0]?.authorization_id ?? null;
});

const openAggregate = Effect.fn("CapsuleManagedDnsConnections.openAggregate")(function* (
  custody: CredentialCustody.Interface,
  aggregate: StoredAggregate,
) {
  const credential = yield* custody
    .open(aggregate.credentialCiphertext)
    .pipe(Effect.mapError((error) => mapCapabilityError("openCredential", error)));
  return {
    attachments: aggregate.attachments,
    authorization: aggregate.authorization,
    connections: aggregate.connections,
    credential,
  } satisfies ManagedDnsConnections.Aggregate;
});

const writeAuthorization = Effect.fn("CapsuleManagedDnsConnections.writeAuthorization")(function* (
  sql: SqlClient.SqlClient,
  authorization: Authorization,
  credentialCiphertext: string,
) {
  const encoded = yield* encodeAuthorization(authorization);
  yield* sql`INSERT INTO domain_provider_authorizations (
        id, provider_id, account_id, subject_id, kind, capabilities, capability_evidence, scopes,
        provider_context, revocation, credential_ciphertext, expires_at, created_at, updated_at
      ) VALUES (
        ${authorization.id}, ${authorization.providerId}, NULL, ${authorization.authorizedById},
        ${authorization.method}, ${JSON.stringify(encoded.requiredCapabilities)}::jsonb,
        ${JSON.stringify(encoded.capabilityEvidence)}::jsonb,
        ${JSON.stringify(encoded.scopes)}::jsonb, ${JSON.stringify(encoded.providerContext)}::jsonb,
        ${JSON.stringify(encoded.revocation)}::jsonb,
        ${credentialCiphertext}, ${authorization.expiresAt}, ${authorization.createdAt}, NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        subject_id = EXCLUDED.subject_id,
        kind = EXCLUDED.kind,
        capabilities = EXCLUDED.capabilities,
        capability_evidence = EXCLUDED.capability_evidence,
        scopes = EXCLUDED.scopes,
        provider_context = EXCLUDED.provider_context,
        revocation = EXCLUDED.revocation,
        credential_ciphertext = EXCLUDED.credential_ciphertext,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()`;
});

const makeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const custody = yield* CredentialCustody.Service;
  const bindings = yield* HostBindings.Service;

  const withRevocationLock = <A, E, R>(
    operation: string,
    authorizationId: string,
    effect: Effect.Effect<A, E, R>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* sql.reserve;
        // SAFETY: PostgreSQL returns one boolean row for pg_try_advisory_lock.
        const rows = (yield* connection.execute(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
          [authorizationId],
          undefined,
        )) as ReadonlyArray<{ readonly acquired: boolean }>;
        if (rows[0]?.acquired !== true)
          return yield* Effect.fail(
            storageError(operation, "Provider revocation is already in progress", "safe"),
          );
        yield* Effect.addFinalizer(() =>
          connection
            .executeRaw("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [authorizationId])
            .pipe(Effect.ignore),
        );
        return yield* effect;
      }),
    );

  const getStored = (authorizationId: string, lock: "share" | "update" = "share") =>
    loadAggregate(sql, bindings, authorizationId, lock);

  const get = (authorizationId: string) =>
    mapSql(
      "get",
      sql
        .withTransaction(getStored(authorizationId))
        .pipe(
          Effect.flatMap((aggregate) =>
            aggregate === null ? Effect.succeed(null) : openAggregate(custody, aggregate),
          ),
        ),
    );

  const getByConnectionId = (connectionId: string) =>
    mapSql(
      "getByConnectionId",
      sql
        .withTransaction(
          Effect.gen(function* () {
            const authorizationId = yield* authorizationIdForConnection(sql, connectionId);
            if (authorizationId === null) return null;
            const aggregate = yield* getStored(authorizationId);
            if (
              aggregate === null ||
              !aggregate.connections.some((connection) => connection.id === connectionId)
            )
              return null;
            return aggregate;
          }),
        )
        .pipe(
          Effect.flatMap((aggregate) =>
            aggregate === null ? Effect.succeed(null) : openAggregate(custody, aggregate),
          ),
        ),
    );

  const service: ManagedDnsConnections.Interface = ManagedDnsConnections.Service.of({
    attach: (input) =>
      mapSql(
        "attach",
        sql.withTransaction(
          Effect.gen(function* () {
            const authorizationId = yield* authorizationIdForConnection(sql, input.connectionId);
            if (authorizationId === null)
              return yield* Effect.fail(missing("attach", "Provider connection does not exist"));
            const aggregate = yield* getStored(authorizationId, "update");
            if (aggregate === null)
              return yield* Effect.fail(missing("attach", "Provider authorization does not exist"));
            const connection = aggregate.connections.find(
              (candidate) =>
                candidate.id === input.connectionId && candidate.ownerId === input.ownerId,
            );
            if (connection === undefined)
              return yield* Effect.fail(
                missing("attach", "Provider connection does not belong to this owner"),
              );
            if (aggregate.authorization.revocation._tag === "Pending")
              return yield* Effect.fail(
                conflict("attach", "Provider authorization is awaiting revocation recovery"),
              );
            if (input.attachment.connectionId !== input.connectionId)
              return yield* Effect.fail(
                conflict("attach", "Domain attachment targets another connection"),
              );
            const existing = aggregate.attachments.find(({ id }) => id === input.attachment.id);
            if (existing !== undefined) {
              if (!sameAttachment(existing, input.attachment))
                return yield* Effect.fail(
                  conflict("attach", "Domain attachment id is already in use"),
                );
              return {
                attachment: existing,
                connection: Connection.project(connection, aggregate.authorization),
              };
            }
            const reference = yield* bindings
              .domain({ domain: input.attachment.domain, ownerId: input.ownerId })
              .pipe(Effect.mapError((error) => mapCapabilityError("attach", error)));
            const context = {
              version: "domainkit.attachment.v1" as const,
              value: {
                accountKind: input.attachment.target.accountKind,
                domain: input.attachment.domain,
                ...(input.attachment.target.evidence === undefined
                  ? {}
                  : { evidence: input.attachment.target.evidence }),
              },
            };
            yield* sql`INSERT INTO domain_provider_attachments (
                id, organization_id, connection_id, domain_id, provider_account_id,
                provider_zone_id, provider_zone_name, provider_target_context, created_at, updated_at
              ) VALUES (
                ${input.attachment.id}, ${reference.ownerReference}, ${input.connectionId},
                ${reference.domainReference}, ${input.attachment.target.accountId},
                ${input.attachment.target.zoneId}, ${input.attachment.target.zoneName},
                ${JSON.stringify(context)}::jsonb,
                ${input.attachment.createdAt}, NOW()
              )`;
            return {
              attachment: input.attachment,
              connection: Connection.project(connection, aggregate.authorization),
            };
          }),
        ),
      ),
    connect: (input) =>
      custody.seal(input.credential).pipe(
        Effect.mapError((error) => mapCapabilityError("connect", error)),
        Effect.flatMap((credentialCiphertext) =>
          mapSql(
            "connect",
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.authorization.id}, 0))`;
                const current = yield* getStored(input.authorization.id, "update");
                if (
                  current?.authorization.revocation._tag === "Pending" ||
                  (input.expectedAuthorizationId !== undefined && current === null)
                )
                  return yield* Effect.fail(
                    conflict(
                      "connect",
                      current === null
                        ? "Provider authorization no longer exists"
                        : "Provider authorization is awaiting revocation recovery",
                    ),
                  );
                if (
                  input.authorization.id !== input.connection.authorizationId ||
                  input.authorization.providerId !== input.connection.providerId ||
                  input.authorization.method !== input.connection.method
                )
                  return yield* Effect.fail(
                    conflict("connect", "Connection does not match its authorization"),
                  );
                const existingConnection = current?.connections.find(
                  ({ ownerId }) => ownerId === input.connection.ownerId,
                );
                if (
                  input.expectedConnectionId !== undefined &&
                  existingConnection?.id !== input.expectedConnectionId
                )
                  return yield* Effect.fail(
                    conflict("connect", "Organization connection changed during reconnect"),
                  );
                yield* writeAuthorization(sql, input.authorization, credentialCiphertext);
                if (existingConnection === undefined) {
                  const reference = yield* bindings
                    .owner(input.connection.ownerId)
                    .pipe(Effect.mapError((error) => mapCapabilityError("connect", error)));
                  yield* sql`INSERT INTO organization_domain_provider_connections (
                        id, organization_id, authorization_id, created_at, updated_at
                      ) VALUES (
                        ${input.connection.id}, ${reference.ownerReference},
                        ${input.authorization.id}, ${input.connection.createdAt}, NOW()
                      )`;
                }
                const stored = yield* getStored(input.authorization.id, "update");
                return (
                  stored ?? (yield* Effect.fail(missing("connect", "Authorization write vanished")))
                );
              }),
            ),
          ),
        ),
        Effect.flatMap((aggregate) => openAggregate(custody, aggregate)),
      ),
    detach: ({ attachmentId, ownerId }) =>
      mapSql(
        "detach",
        sql.withTransaction(
          Effect.gen(function* () {
            const authorizationId = yield* authorizationIdForAttachment(sql, attachmentId);
            if (authorizationId === null)
              return yield* Effect.fail(missing("detach", "Domain attachment does not exist"));
            const aggregate = yield* getStored(authorizationId, "update");
            const attachment = aggregate?.attachments.find(({ id }) => id === attachmentId);
            if (aggregate === null || attachment === undefined)
              return yield* Effect.fail(missing("detach", "Domain attachment does not exist"));
            const connection = aggregate.connections.find(
              ({ id, ownerId: candidate }) =>
                id === attachment.connectionId && candidate === ownerId,
            );
            if (connection === undefined)
              return yield* Effect.fail(
                missing("detach", "Domain attachment does not belong to this owner"),
              );
            yield* sql`DELETE FROM domain_provider_attachments WHERE id = ${attachmentId}`;
            return {
              attachment,
              connection: Connection.project(connection, aggregate.authorization),
              remainingAttachments: aggregate.attachments.filter(
                ({ connectionId, id }) => connectionId === connection.id && id !== attachmentId,
              ).length,
            };
          }),
        ),
      ),
    disconnect: <E>({
      connectionId,
      ownerId,
      revoke,
    }: {
      readonly connectionId: string;
      readonly ownerId: string;
      readonly revoke: (authorization: Authorization) => Effect.Effect<void, E>;
    }) =>
      mapSql(
        "disconnect",
        sql
          .withTransaction(
            Effect.gen(function* () {
              const authorizationId = yield* authorizationIdForConnection(sql, connectionId);
              if (authorizationId === null)
                return yield* Effect.fail(
                  missing("disconnect", "Provider connection does not exist"),
                );
              const aggregate = yield* getStored(authorizationId, "update");
              const connection = aggregate?.connections.find(
                ({ id, ownerId: candidate }) => id === connectionId && candidate === ownerId,
              );
              if (aggregate === null || connection === undefined)
                return yield* Effect.fail(
                  missing("disconnect", "Provider connection does not belong to this owner"),
                );
              if (aggregate.attachments.some(({ connectionId: id }) => id === connectionId))
                return yield* Effect.fail(
                  conflict(
                    "disconnect",
                    "Detach all organization domains before disconnecting the provider",
                  ),
                );
              if (aggregate.connections.length > 1) {
                yield* sql`DELETE FROM organization_domain_provider_connections
                  WHERE id = ${connectionId}`;
                return {
                  _tag: "Disconnected" as const,
                  connection: Connection.project(connection, aggregate.authorization),
                  remainingConnections: aggregate.connections.length - 1,
                };
              }
              if (aggregate.authorization.revocation._tag === "Pending")
                return yield* Effect.fail(
                  conflict("disconnect", "Provider authorization is awaiting revocation recovery"),
                );
              const pending: Authorization = {
                ...aggregate.authorization,
                revocation: { _tag: "Pending", requestedAt: new Date() },
              };
              yield* writeAuthorization(sql, pending, aggregate.credentialCiphertext);
              return {
                _tag: "Prepared" as const,
                authorization: pending,
                connection: Connection.project(connection, pending),
              };
            }),
          )
          .pipe(
            Effect.flatMap((prepared) => {
              if (prepared._tag === "Disconnected") {
                const result: ManagedDnsConnections.DisconnectResult = {
                  connection: prepared.connection,
                  remainingConnections: prepared.remainingConnections,
                  revokedAuthorization: false,
                };
                return Effect.succeed(result);
              }
              const result: ManagedDnsConnections.DisconnectResult = {
                connection: prepared.connection,
                remainingConnections: 0,
                revokedAuthorization: true,
              };
              return withRevocationLock(
                "disconnect",
                prepared.authorization.id,
                sql.withTransaction(getStored(prepared.authorization.id, "update")).pipe(
                  Effect.flatMap((current) => {
                    if (current?.authorization.revocation._tag !== "Pending")
                      return Effect.fail(
                        conflict("disconnect", "Revocation state changed before provider call"),
                      );
                    return revoke(current.authorization).pipe(
                      Effect.andThen(
                        sql.withTransaction(
                          Effect.gen(function* () {
                            const aggregate = yield* getStored(prepared.authorization.id, "update");
                            if (aggregate?.authorization.revocation._tag !== "Pending")
                              return yield* Effect.fail(
                                conflict(
                                  "disconnect",
                                  "Revocation state changed before completion",
                                ),
                              );
                            yield* sql`DELETE FROM domain_provider_attachments WHERE connection_id IN
                        (SELECT id FROM organization_domain_provider_connections
                         WHERE authorization_id = ${prepared.authorization.id})`;
                            yield* sql`DELETE FROM organization_domain_provider_connections
                        WHERE authorization_id = ${prepared.authorization.id}`;
                            yield* sql`DELETE FROM domain_provider_authorizations
                        WHERE id = ${prepared.authorization.id}`;
                          }),
                        ),
                      ),
                      Effect.as(result),
                    );
                  }),
                ),
              );
            }),
          ),
      ),
    findConnection: (ownerId, authorizationId) =>
      get(authorizationId).pipe(
        Effect.map(
          (aggregate) =>
            aggregate?.connections.find((connection) => connection.ownerId === ownerId) ?? null,
        ),
      ),
    get,
    getAttachment: (attachmentId) =>
      mapSql(
        "getAttachment",
        sql.withTransaction(
          Effect.gen(function* () {
            const authorizationId = yield* authorizationIdForAttachment(sql, attachmentId);
            if (authorizationId === null) return null;
            const aggregate = yield* getStored(authorizationId);
            return aggregate?.attachments.find(({ id }) => id === attachmentId) ?? null;
          }),
        ),
      ),
    getByConnectionId,
    listAttachments: (connectionId, ownerId) =>
      getByConnectionId(connectionId).pipe(
        Effect.flatMap((aggregate) => {
          if (aggregate === null)
            return Effect.fail(missing("listAttachments", "Provider connection does not exist"));
          if (
            !aggregate.connections.some(
              (connection) => connection.id === connectionId && connection.ownerId === ownerId,
            )
          )
            return Effect.fail(
              missing("listAttachments", "Provider connection does not belong to this owner"),
            );
          return Effect.succeed(
            aggregate.attachments.filter((attachment) => attachment.connectionId === connectionId),
          );
        }),
      ),
    promoteEvidence: (authorizationId, evidence) =>
      mapSql(
        "promoteEvidence",
        sql.withTransaction(
          Effect.gen(function* () {
            const aggregate = yield* getStored(authorizationId, "update");
            if (aggregate === null)
              return yield* Effect.fail(
                missing("promoteEvidence", "Provider authorization does not exist"),
              );
            const byCapability = new Map(
              aggregate.authorization.capabilityEvidence.map((item) => [item.capability, item]),
            );
            for (const item of evidence) byCapability.set(item.capability, item);
            yield* writeAuthorization(
              sql,
              {
                ...aggregate.authorization,
                capabilityEvidence: [...byCapability.values()],
              },
              aggregate.credentialCiphertext,
            );
            return (
              (yield* getStored(authorizationId, "update")) ??
              (yield* Effect.fail(missing("promoteEvidence", "Authorization write vanished")))
            );
          }),
        ),
      ).pipe(Effect.flatMap((aggregate) => openAggregate(custody, aggregate))),
    recover: ({ authorizationId, revoke }) =>
      mapSql(
        "recover",
        withRevocationLock(
          "recover",
          authorizationId,
          sql.withTransaction(getStored(authorizationId, "update")).pipe(
            Effect.flatMap((aggregate) => {
              if (aggregate === null)
                return Effect.fail(missing("recover", "Provider authorization does not exist"));
              if (aggregate.authorization.revocation._tag !== "Pending")
                return Effect.fail(
                  missing("recover", "Provider authorization is not awaiting revocation"),
                );
              const connection = aggregate.connections[0];
              if (connection === undefined)
                return Effect.fail(missing("recover", "Pending authorization has no connection"));
              return revoke(aggregate.authorization).pipe(
                Effect.andThen(
                  sql.withTransaction(
                    Effect.gen(function* () {
                      const current = yield* getStored(authorizationId, "update");
                      if (current?.authorization.revocation._tag !== "Pending")
                        return yield* Effect.fail(
                          conflict("recover", "Revocation state changed before completion"),
                        );
                      yield* sql`DELETE FROM domain_provider_attachments WHERE connection_id IN
                        (SELECT id FROM organization_domain_provider_connections
                         WHERE authorization_id = ${authorizationId})`;
                      yield* sql`DELETE FROM organization_domain_provider_connections
                        WHERE authorization_id = ${authorizationId}`;
                      yield* sql`DELETE FROM domain_provider_authorizations WHERE id = ${authorizationId}`;
                    }),
                  ),
                ),
                Effect.as({
                  connection: Connection.project(connection, aggregate.authorization),
                  remainingConnections: 0,
                  revokedAuthorization: true,
                }),
              );
            }),
          ),
        ),
      ),
    rotate: (authorizationId, credential, expiresAt) =>
      custody.seal(credential).pipe(
        Effect.mapError((error) => mapCapabilityError("rotate", error)),
        Effect.flatMap((credentialCiphertext) =>
          mapSql(
            "rotate",
            sql.withTransaction(
              Effect.gen(function* () {
                const aggregate = yield* getStored(authorizationId, "update");
                if (aggregate === null)
                  return yield* Effect.fail(
                    missing("rotate", "Provider authorization does not exist"),
                  );
                yield* writeAuthorization(
                  sql,
                  { ...aggregate.authorization, expiresAt },
                  credentialCiphertext,
                );
                return (
                  (yield* getStored(authorizationId, "update")) ??
                  (yield* Effect.fail(missing("rotate", "Authorization write vanished")))
                );
              }),
            ),
          ),
        ),
        Effect.flatMap((aggregate) => openAggregate(custody, aggregate)),
      ),
  });

  return service;
});

const migration = makeMigration({
  id: 1,
  name: "adopt-authorization-lifecycle",
  risk: "additive",
  providers: {
    Postgres: sqlMigrationBody([
      `CREATE TABLE IF NOT EXISTS domain_provider_authorizations (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        account_id TEXT,
        subject_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        capabilities JSONB NOT NULL,
        capability_evidence JSONB NOT NULL,
        scopes JSONB NOT NULL,
        provider_context JSONB NOT NULL,
        revocation JSONB NOT NULL,
        credential_ciphertext TEXT,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `ALTER TABLE domain_provider_authorizations
        DROP CONSTRAINT IF EXISTS uq_domain_provider_authorizations_provider_account`,
      `ALTER TABLE domain_provider_authorizations ALTER COLUMN account_id DROP NOT NULL`,
      `CREATE TABLE IF NOT EXISTS organization_domain_provider_connections (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        authorization_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_organization_domain_provider_connections_org_authorization
          UNIQUE (organization_id, authorization_id),
        CONSTRAINT uq_organization_domain_provider_connections_id_org
          UNIQUE (id, organization_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_organization_domain_provider_connections_authorization
        ON organization_domain_provider_connections (authorization_id)`,
      `DO $$ BEGIN
        IF to_regclass('domain_connections') IS NOT NULL THEN
          INSERT INTO organization_domain_provider_connections (
            id, organization_id, authorization_id, created_at, updated_at
          ) SELECT id, organization_id, authorization_id, created_at, updated_at
            FROM domain_connections ON CONFLICT DO NOTHING;
        END IF;
      END $$`,
      `CREATE TABLE IF NOT EXISTS domain_provider_attachments (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        domain_id TEXT NOT NULL,
        provider_account_id TEXT NOT NULL,
        provider_zone_id TEXT NOT NULL,
        provider_zone_name TEXT NOT NULL,
        provider_target_context JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_domain_provider_attachments_org_domain UNIQUE (organization_id, domain_id),
        CONSTRAINT uq_domain_provider_attachments_connection_domain UNIQUE (connection_id, domain_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_domain_provider_attachments_connection
        ON domain_provider_attachments (connection_id)`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM domain_provider_authorizations WHERE credential_ciphertext IS NULL)
        THEN RAISE EXCEPTION 'DomainKit adoption requires encrypted credential ciphertext';
        END IF;
        IF EXISTS (
          SELECT 1 FROM domain_provider_attachments
          WHERE provider_target_context #>> '{value,domain}' IS NULL
        ) THEN RAISE EXCEPTION 'DomainKit adoption requires semantic attachment domains';
        END IF;
      END $$`,
    ]),
  },
});

/** PostgreSQL-only authorization lifecycle capsule. The host must prepare its registry at startup. */
export const capsule = Effect.gen(function* () {
  const definedMigration = yield* migration;
  return yield* makeCapsule({
    id: "domainkit.authorization-lifecycle",
    migrations: [definedMigration],
    layer: Layer.effect(ManagedDnsConnections.Service, makeRepository),
  });
});
