import { PgClient } from "@effect/sql-pg";
import { assert, describe, it } from "@effect/vitest";
import { makeRegistry, prepare } from "capsuledb";
import { Pg } from "capsuledb";
import { Connection, DomainName, ManagedDnsConnections, Secret } from "domainkit";
import { Deferred, Effect, Fiber } from "effect";
import { sql as drizzleSql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";

import { CredentialCustody, HostBindings, capsule } from "../src/index.ts";
import { withPostgres } from "./postgres.ts";

const custody = CredentialCustody.Service.of({
  open: (ciphertext) =>
    Effect.sync(() => {
      const parsed = JSON.parse(Buffer.from(ciphertext, "base64url").toString("utf8")) as {
        accessToken: string;
        refreshToken: string | null;
        tokenType: string;
      };
      return {
        accessToken: Secret.make(parsed.accessToken),
        refreshToken: parsed.refreshToken === null ? null : Secret.make(parsed.refreshToken),
        tokenType: parsed.tokenType,
      };
    }),
  seal: (credential) =>
    Effect.sync(() =>
      Buffer.from(
        JSON.stringify({
          accessToken: credential.accessToken.expose(),
          refreshToken: credential.refreshToken?.expose() ?? null,
          tokenType: credential.tokenType,
        }),
      ).toString("base64url"),
    ),
});

const bindings = HostBindings.Service.of({
  domain: ({ domain, ownerId }) =>
    Effect.succeed({ domainReference: `${ownerId}:${domain}`, ownerReference: ownerId }),
  owner: (ownerId) => Effect.succeed({ ownerReference: ownerId }),
  ownerId: Effect.succeed,
});

const authorization = (
  id = "authorization-1",
): ManagedDnsConnections.Authorization.ProviderAuthorization => ({
  authorizedById: "admin-1",
  capabilityEvidence: [
    {
      capability: "dns:read",
      evidence: ManagedDnsConnections.Authorization.Evidence.Declared(),
    },
  ],
  createdAt: new Date("2026-08-31T00:00:00.000Z"),
  expiresAt: null,
  id,
  method: "token",
  providerContext: { value: {}, version: "test.v1" },
  providerId: "cloudflare",
  requiredCapabilities: ["dns:read", "dns:write"],
  revocation: { _tag: "Active" },
  scopes: ["dns:write"],
});

const connection = (
  authorizationId = "authorization-1",
  ownerId = "organization-1",
): ManagedDnsConnections.StoredConnection => ({
  authorizationId,
  createdAt: new Date("2026-08-31T00:00:00.000Z"),
  id: `connection-${ownerId}`,
  method: "token",
  ownerId,
  providerId: "cloudflare",
});

const credential = (token: string): ManagedDnsConnections.StoredCredential => ({
  accessToken: Secret.make(token),
  refreshToken: null,
  tokenType: "bearer",
});

const attachment = (connectionId: string): Connection.DomainAttachment => ({
  connectionId,
  createdAt: new Date("2026-08-31T01:00:00.000Z"),
  domain: DomainName.parse("mail.example.com"),
  id: "attachment-1",
  target: {
    accountId: "account-1",
    accountKind: "account",
    zoneId: "zone-1",
    zoneName: DomainName.parse("example.com"),
  },
});

const withRepository = <A, E>(
  client: PgClient.PgClient,
  effect: (repository: ManagedDnsConnections.Interface) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const definedCapsule = yield* capsule;
    const registry = yield* makeRegistry({ capsules: [definedCapsule], provider: Pg.profile });
    yield* prepare(registry);
    return yield* Effect.gen(function* () {
      const repository = yield* ManagedDnsConnections.Service;
      return yield* effect(repository);
    }).pipe(
      Effect.provide(definedCapsule.layer),
      Effect.provideService(CredentialCustody.Service, custody),
      Effect.provideService(HostBindings.Service, bindings),
      Effect.provideService(PgClient.PgClient, client),
    );
  });

describe("PostgreSQL authorization lifecycle capsule", () => {
  it.effect(
    "fails closed until legacy attachment rows carry a semantic domain",
    () =>
      withPostgres((client) =>
        Effect.gen(function* () {
          yield* client.unsafe(`
            CREATE TABLE domain_provider_authorizations (
              id text PRIMARY KEY, provider_id text NOT NULL, account_id text,
              subject_id text NOT NULL, kind text NOT NULL, capabilities jsonb NOT NULL,
              capability_evidence jsonb NOT NULL, scopes jsonb NOT NULL,
              provider_context jsonb NOT NULL, revocation jsonb NOT NULL,
              credential_ciphertext text, expires_at timestamptz,
              created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
            );
            CREATE TABLE organization_domain_provider_connections (
              id text PRIMARY KEY, organization_id text NOT NULL, authorization_id text NOT NULL,
              created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
              UNIQUE (organization_id, authorization_id), UNIQUE (id, organization_id)
            );
            CREATE TABLE domain_provider_attachments (
              id text PRIMARY KEY, organization_id text NOT NULL, connection_id text NOT NULL,
              domain_id text NOT NULL, provider_account_id text NOT NULL,
              provider_zone_id text NOT NULL, provider_zone_name text NOT NULL,
              provider_target_context jsonb NOT NULL,
              created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
              UNIQUE (organization_id, domain_id), UNIQUE (connection_id, domain_id)
            );
            INSERT INTO domain_provider_authorizations VALUES (
              'authorization-1', 'cloudflare', 'account-1', 'admin-1', 'token',
              '["dns:read"]', '[]', '[]', '{"version":"test.v1","value":{}}',
              '{"_tag":"Active"}', 'existing-ciphertext', NULL, NOW(), NOW()
            );
            INSERT INTO organization_domain_provider_connections VALUES (
              'connection-1', 'organization-1', 'authorization-1', NOW(), NOW()
            );
            INSERT INTO domain_provider_attachments VALUES (
              'attachment-1', 'organization-1', 'connection-1', 'domain-1', 'account-1',
              'zone-1', 'example.com',
              '{"version":"domainkit.provider-target.v1","value":{"accountKind":"account"}}',
              NOW(), NOW()
            );
          `);
          const definedCapsule = yield* capsule;
          const registry = yield* makeRegistry({
            capsules: [definedCapsule],
            provider: Pg.profile,
          });
          const rejected = yield* prepare(registry).pipe(Effect.result);
          assert.strictEqual(rejected._tag, "Failure");

          yield* client`UPDATE domain_provider_attachments
            SET provider_target_context = '{"version":"domainkit.attachment.v1","value":{"accountKind":"account","domain":"mail.example.com"}}'::jsonb
            WHERE id = 'attachment-1'`;
          yield* prepare(registry);
          assert.deepStrictEqual(
            yield* client<{
              readonly credential_ciphertext: string;
              readonly domain_id: string;
              readonly id: string;
            }>`SELECT a.id, a.domain_id, p.credential_ciphertext
              FROM domain_provider_attachments a
              JOIN organization_domain_provider_connections c ON c.id = a.connection_id
              JOIN domain_provider_authorizations p ON p.id = c.authorization_id`,
            [
              {
                credential_ciphertext: "existing-ciphertext",
                domain_id: "domain-1",
                id: "attachment-1",
              },
            ],
          );
        }),
      ),
    60_000,
  );

  it.effect(
    "persists the complete lifecycle without storing plaintext credentials",
    () =>
      withPostgres((client) =>
        withRepository(client, (repository) =>
          Effect.gen(function* () {
            const auth = authorization();
            const storedConnection = connection();
            const aggregate = yield* repository.connect({
              authorization: auth,
              connection: storedConnection,
              credential: credential("secret-token"),
            });
            assert.strictEqual(aggregate.connections.length, 1);
            assert.strictEqual(aggregate.credential.accessToken.expose(), "secret-token");

            const rows = yield* client<{ readonly credential_ciphertext: string }>`SELECT
              credential_ciphertext FROM domain_provider_authorizations WHERE id = ${auth.id}`;
            assert.notStrictEqual(rows[0]?.credential_ciphertext, "secret-token");

            yield* repository.attach({
              attachment: attachment(storedConnection.id),
              connectionId: storedConnection.id,
              ownerId: storedConnection.ownerId,
            });
            assert.strictEqual((yield* repository.get(auth.id))?.attachments.length, 1);

            const blocked = yield* repository
              .disconnect({
                connectionId: storedConnection.id,
                ownerId: storedConnection.ownerId,
                revoke: () => Effect.void,
              })
              .pipe(Effect.result);
            assert.strictEqual(blocked._tag, "Failure");

            yield* repository.detach({
              attachmentId: "attachment-1",
              ownerId: storedConnection.ownerId,
            });
            const failed = yield* repository
              .disconnect({
                connectionId: storedConnection.id,
                ownerId: storedConnection.ownerId,
                revoke: () => Effect.fail("provider unavailable" as const),
              })
              .pipe(Effect.result);
            assert.strictEqual(failed._tag, "Failure");
            assert.strictEqual(
              (yield* repository.get(auth.id))?.authorization.revocation._tag,
              "Pending",
            );
            yield* repository.recover({ authorizationId: auth.id, revoke: () => Effect.void });
            assert.strictEqual(yield* repository.get(auth.id), null);
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "serializes concurrent recovery before invoking provider revocation",
    () =>
      withPostgres((client) =>
        withRepository(client, (repository) =>
          Effect.gen(function* () {
            const auth = authorization();
            const storedConnection = connection();
            yield* repository.connect({
              authorization: auth,
              connection: storedConnection,
              credential: credential("token"),
            });
            yield* repository
              .disconnect({
                connectionId: storedConnection.id,
                ownerId: storedConnection.ownerId,
                revoke: () => Effect.fail("provider unavailable" as const),
              })
              .pipe(Effect.result);

            let revocations = 0;
            const revocationStarted = yield* Deferred.make<void>();
            const finishRevocation = yield* Deferred.make<void>();
            const firstAttempt = yield* repository
              .recover({
                authorizationId: auth.id,
                revoke: () =>
                  Effect.sync(() => void revocations++).pipe(
                    Effect.andThen(Deferred.succeed(revocationStarted, undefined)),
                    Effect.andThen(Deferred.await(finishRevocation)),
                  ),
              })
              .pipe(Effect.result, Effect.forkChild);
            yield* Deferred.await(revocationStarted);
            const concurrentAttempt = yield* repository
              .recover({
                authorizationId: auth.id,
                revoke: () => Effect.sync(() => void revocations++),
              })
              .pipe(Effect.result, Effect.forkChild);
            yield* Deferred.succeed(finishRevocation, undefined);

            const attempts = yield* Effect.all(
              [Fiber.join(firstAttempt), Fiber.join(concurrentAttempt)],
              { concurrency: "unbounded" },
            );
            assert.strictEqual(attempts.filter(({ _tag }) => _tag === "Success").length, 1);
            assert.strictEqual(attempts.filter(({ _tag }) => _tag === "Failure").length, 1);
            assert.strictEqual(revocations, 1);
            assert.strictEqual(yield* repository.get(auth.id), null);
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "serializes concurrent evidence promotion without lost updates",
    () =>
      withPostgres((client) =>
        withRepository(client, (repository) =>
          Effect.gen(function* () {
            const auth = authorization();
            yield* repository.connect({
              authorization: auth,
              connection: connection(),
              credential: credential("token"),
            });
            const observedAt = new Date("2026-08-31T02:00:00.000Z");
            yield* Effect.all(
              [
                repository.promoteEvidence(auth.id, [
                  {
                    capability: "dns:read",
                    evidence: ManagedDnsConnections.Authorization.Evidence.Introspected({
                      observedAt,
                    }),
                  },
                ]),
                repository.promoteEvidence(auth.id, [
                  {
                    capability: "dns:write",
                    evidence: ManagedDnsConnections.Authorization.Evidence.Exercised({
                      observedAt,
                    }),
                  },
                ]),
              ],
              { concurrency: "unbounded" },
            );
            const final = yield* repository.get(auth.id);
            assert.deepStrictEqual(
              final?.authorization.capabilityEvidence.map(({ capability }) => capability).sort(),
              ["dns:read", "dns:write"],
            );
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "shares one authorization and prepares final revocation exactly once",
    () =>
      withPostgres((client) =>
        withRepository(client, (repository) =>
          Effect.gen(function* () {
            const auth = authorization();
            const first = connection(auth.id, "organization-1");
            const second = connection(auth.id, "organization-2");
            yield* repository.connect({
              authorization: auth,
              connection: first,
              credential: credential("token-1"),
            });
            const shared = yield* repository.connect({
              authorization: auth,
              connection: second,
              credential: credential("token-2"),
              expectedAuthorizationId: auth.id,
            });
            assert.strictEqual(shared.connections.length, 2);

            let revocations = 0;
            const firstDisconnect = yield* repository.disconnect({
              connectionId: first.id,
              ownerId: first.ownerId,
              revoke: () => Effect.sync(() => void revocations++),
            });
            assert.strictEqual(firstDisconnect.revokedAuthorization, false);
            assert.strictEqual(firstDisconnect.remainingConnections, 1);

            const revocationStarted = yield* Deferred.make<void>();
            const finishRevocation = yield* Deferred.make<void>();
            const firstAttempt = yield* repository
              .disconnect({
                connectionId: second.id,
                ownerId: second.ownerId,
                revoke: () =>
                  Effect.sync(() => void revocations++).pipe(
                    Effect.andThen(Deferred.succeed(revocationStarted, undefined)),
                    Effect.andThen(Deferred.await(finishRevocation)),
                  ),
              })
              .pipe(Effect.result, Effect.forkChild);
            yield* Deferred.await(revocationStarted);
            const concurrentAttempt = yield* repository
              .disconnect({
                connectionId: second.id,
                ownerId: second.ownerId,
                revoke: () => Effect.sync(() => void revocations++),
              })
              .pipe(Effect.result, Effect.forkChild);
            yield* Deferred.succeed(finishRevocation, undefined);
            const attempts = yield* Effect.all(
              [Fiber.join(firstAttempt), Fiber.join(concurrentAttempt)],
              { concurrency: "unbounded" },
            );
            assert.strictEqual(attempts.filter(({ _tag }) => _tag === "Success").length, 1);
            assert.strictEqual(attempts.filter(({ _tag }) => _tag === "Failure").length, 1);
            assert.strictEqual(revocations, 1);
            assert.strictEqual(yield* repository.get(auth.id), null);
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "serializes final disconnect against revocation recovery",
    () =>
      withPostgres((client) =>
        withRepository(client, (repository) =>
          Effect.gen(function* () {
            const auth = authorization();
            const storedConnection = connection();
            yield* repository.connect({
              authorization: auth,
              connection: storedConnection,
              credential: credential("token"),
            });

            let revocations = 0;
            const revocationStarted = yield* Deferred.make<void>();
            const finishRevocation = yield* Deferred.make<void>();
            const disconnectAttempt = yield* repository
              .disconnect({
                connectionId: storedConnection.id,
                ownerId: storedConnection.ownerId,
                revoke: () =>
                  Effect.sync(() => void revocations++).pipe(
                    Effect.andThen(Deferred.succeed(revocationStarted, undefined)),
                    Effect.andThen(Deferred.await(finishRevocation)),
                  ),
              })
              .pipe(Effect.result, Effect.forkChild);
            yield* Deferred.await(revocationStarted);
            const recoveryAttempt = yield* repository
              .recover({
                authorizationId: auth.id,
                revoke: () => Effect.sync(() => void revocations++),
              })
              .pipe(Effect.result, Effect.forkChild);
            yield* Deferred.succeed(finishRevocation, undefined);

            const attempts = yield* Effect.all(
              [Fiber.join(disconnectAttempt), Fiber.join(recoveryAttempt)],
              { concurrency: "unbounded" },
            );
            assert.strictEqual(attempts.filter(({ _tag }) => _tag === "Success").length, 1);
            assert.strictEqual(attempts.filter(({ _tag }) => _tag === "Failure").length, 1);
            assert.strictEqual(revocations, 1);
            assert.strictEqual(yield* repository.get(auth.id), null);
          }),
        ),
      ),
    60_000,
  );

  it.effect(
    "joins a host Drizzle transaction through the exact same PgClient",
    () =>
      withPostgres((client) =>
        withRepository(client, (repository) =>
          Effect.gen(function* () {
            const db = yield* PgDrizzle.makeWithDefaults().pipe(
              Effect.provideService(PgClient.PgClient, client),
            );
            yield* client.unsafe("CREATE TABLE host_transaction_probe (value INTEGER NOT NULL)");
            yield* db
              .transaction((tx) =>
                Effect.gen(function* () {
                  yield* tx.execute(
                    drizzleSql`INSERT INTO host_transaction_probe (value) VALUES (1)`,
                  );
                  yield* repository.connect({
                    authorization: authorization(),
                    connection: connection(),
                    credential: credential("token"),
                  });
                  return yield* Effect.fail("rollback" as const);
                }),
              )
              .pipe(Effect.flip);
            assert.deepStrictEqual(
              yield* client<{ readonly count: number }>`SELECT COUNT(*)::integer AS count
                FROM host_transaction_probe`,
              [{ count: 0 }],
            );
            assert.deepStrictEqual(
              yield* client<{ readonly count: number }>`SELECT COUNT(*)::integer AS count
                FROM domain_provider_authorizations`,
              [{ count: 0 }],
            );
          }),
        ),
      ),
    60_000,
  );
});
