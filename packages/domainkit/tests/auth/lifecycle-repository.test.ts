import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { Connection, Digest, ManagedDnsConnections, Secret } from "../../src/index.ts";
import * as ProviderAuthorization from "../../src/auth/authorization.ts";
import * as DomainName from "../../src/domain/domain-name.ts";
import { InMemoryManagedDnsConnections } from "../../src/testing.ts";

const authentication = (token: string): Connection.Authentication => ({
  capabilityEvidence: [
    {
      capability: "dns:read",
      evidence: ProviderAuthorization.Evidence.Introspected({ observedAt: new Date() }),
    },
    {
      capability: "dns:write",
      evidence: ProviderAuthorization.Evidence.Introspected({ observedAt: new Date() }),
    },
  ],
  credential: {
    accessToken: Secret.make(token),
    expiresAt: null,
    refreshToken: null,
    tokenType: "bearer",
  },
  providerAccountId: "account-1",
  providerContext: { value: {}, version: "cloudflare.v1" },
  scopes: ["dns:write"],
});

const connect = (ownerId: string, token: string, authorizationId?: string) =>
  Connection.start({
    authorizedById: `admin:${ownerId}`,
    ...(authorizationId === undefined ? {} : { authorizationId }),
    method: Connection.Method.Token({
      authenticate: () => Effect.succeed(authentication(token)),
      providerId: "cloudflare",
      requiredCapabilities: ["dns:read", "dns:write"],
      token: Secret.make(token),
    }),
    ownerId,
  });

const attachment = (
  connectionId: string,
  id: string,
  domain = "mail.example.com",
): Connection.DomainAttachment => ({
  connectionId,
  createdAt: new Date("2026-08-29T00:00:00.000Z"),
  domain: DomainName.parse(domain),
  id,
  target: {
    accountId: "account-1",
    accountKind: "account" as const,
    zoneId: "zone-1",
    zoneName: DomainName.parse("example.com"),
  },
});

describe("managed DNS lifecycle repository", () => {
  it.effect("does not infer shared authorizations from a provider account", () => {
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(ManagedDnsConnections.Service, repository),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const first = yield* connect("organization-1", "token-1");
      const second = yield* connect("organization-2", "token-2");
      if (first._tag !== "Connected" || second._tag !== "Connected") {
        return yield* Effect.die("connection redirected");
      }
      const firstAggregate = yield* repository.getByConnectionId(first.connection.id);
      const secondAggregate = yield* repository.getByConnectionId(second.connection.id);
      assert.notStrictEqual(firstAggregate?.authorization.id, secondAggregate?.authorization.id);
      assert.strictEqual(firstAggregate?.connections.length, 1);
      assert.strictEqual(secondAggregate?.connections.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("shares an authorization while keeping organization connections explicit", () => {
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(ManagedDnsConnections.Service, repository),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const first = yield* connect("organization-1", "token-1");
      if (first._tag !== "Connected") return yield* Effect.die("first connection redirected");
      const firstAggregate = yield* repository.getByConnectionId(first.connection.id);
      if (firstAggregate === null) return yield* Effect.die("first aggregate is missing");
      const second = yield* connect("organization-2", "token-2", firstAggregate.authorization.id);
      if (second._tag !== "Connected") return yield* Effect.die("second connection redirected");
      const aggregate = yield* repository.get(firstAggregate.authorization.id);
      assert.strictEqual(aggregate?.connections.length, 2);
      assert.strictEqual(aggregate?.attachments.length, 0);
      assert.strictEqual(aggregate?.credential.accessToken.expose(), "token-2");

      let revocations = 0;
      const firstDisconnect = yield* Connection.disconnect({
        connectionId: first.connection.id,
        ownerId: first.connection.ownerId,
        revokeAuthorization: () => Effect.sync(() => void revocations++),
      });
      assert.strictEqual(firstDisconnect.remainingConnections, 1);
      assert.strictEqual(firstDisconnect.revokedAuthorization, false);
      const secondDisconnect = yield* Connection.disconnect({
        connectionId: second.connection.id,
        ownerId: second.connection.ownerId,
        revokeAuthorization: () => Effect.sync(() => void revocations++),
      });
      assert.strictEqual(secondDisconnect.remainingConnections, 0);
      assert.strictEqual(secondDisconnect.revokedAuthorization, true);
      assert.strictEqual(revocations, 1);
      assert.strictEqual(yield* repository.get(firstAggregate.authorization.id), null);
    }).pipe(Effect.provide(layer));
  });

  it.effect("enforces organization/domain uniqueness and retains a connection after detach", () => {
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(ManagedDnsConnections.Service, repository),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const first = yield* connect("organization-1", "token-1");
      if (first._tag !== "Connected") return yield* Effect.die("connection redirected");
      const attached = yield* Connection.attach({
        attachment: attachment(first.connection.id, "attachment-1"),
        connectionId: first.connection.id,
        ownerId: first.connection.ownerId,
      });
      assert.strictEqual(attached.attachment.domain, "mail.example.com");
      assert.strictEqual(
        (yield* repository.listAttachments(first.connection.id, "organization-1")).length,
        1,
      );

      const duplicateConnection = yield* connect("organization-1", "token-2");
      if (duplicateConnection._tag !== "Connected") {
        return yield* Effect.die("duplicate connection redirected");
      }
      const duplicate = yield* Connection.attach({
        attachment: attachment(duplicateConnection.connection.id, "attachment-2"),
        connectionId: duplicateConnection.connection.id,
        ownerId: duplicateConnection.connection.ownerId,
      }).pipe(Effect.result);
      assert.strictEqual(duplicate._tag, "Failure");
      if (duplicate._tag === "Failure") {
        assert.strictEqual(duplicate.failure._tag, "ManagedDnsLifecycleError");
      }

      const removed = yield* Connection.detach({
        attachmentId: "attachment-1",
        ownerId: "organization-1",
      });
      assert.strictEqual(removed.remainingAttachments, 0);
      assert.notStrictEqual(yield* repository.getByConnectionId(first.connection.id), null);
    }).pipe(Effect.provide(layer));
  });

  it.effect("blocks disconnect while a domain attachment exists", () => {
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(ManagedDnsConnections.Service, repository),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const connected = yield* connect("organization-1", "token");
      if (connected._tag !== "Connected") return yield* Effect.die("connection redirected");
      yield* Connection.attach({
        attachment: attachment(connected.connection.id, "attachment-1"),
        connectionId: connected.connection.id,
        ownerId: connected.connection.ownerId,
      });
      const blocked = yield* Connection.disconnect({
        connectionId: connected.connection.id,
        ownerId: connected.connection.ownerId,
        revokeAuthorization: () => Effect.void,
      }).pipe(Effect.result);
      assert.strictEqual(blocked._tag, "Failure");
      yield* Connection.detach({ attachmentId: "attachment-1", ownerId: "organization-1" });
      const disconnected = yield* Connection.disconnect({
        connectionId: connected.connection.id,
        ownerId: connected.connection.ownerId,
        revokeAuthorization: () => Effect.void,
      });
      assert.strictEqual(disconnected.revokedAuthorization, true);
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps failed final revocation pending and recovers it", () => {
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(ManagedDnsConnections.Service, repository),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const connected = yield* connect("organization-1", "token");
      if (connected._tag !== "Connected") return yield* Effect.die("connection redirected");
      const aggregate = yield* repository.getByConnectionId(connected.connection.id);
      if (aggregate === null) return yield* Effect.die("aggregate is missing");
      const failed = yield* Connection.disconnect({
        connectionId: connected.connection.id,
        ownerId: connected.connection.ownerId,
        revokeAuthorization: () => Effect.fail("provider unavailable" as const),
      }).pipe(Effect.result);
      assert.strictEqual(failed._tag, "Failure");
      const pending = yield* repository.get(aggregate.authorization.id);
      assert.strictEqual(pending?.authorization.revocation._tag, "Pending");
      const reconnect = yield* connect(
        "organization-1",
        "token-reconnect",
        aggregate.authorization.id,
      ).pipe(Effect.result);
      assert.strictEqual(reconnect._tag, "Failure");
      assert.strictEqual(
        (yield* repository.get(aggregate.authorization.id))?.authorization.revocation._tag,
        "Pending",
      );
      const staleConnection = aggregate.connections[0];
      if (staleConnection === undefined) return yield* Effect.die("connection is missing");
      const stalePending = yield* repository
        .connect({
          authorization: aggregate.authorization,
          connection: staleConnection,
          credential: aggregate.credential,
          expectedAuthorizationId: aggregate.authorization.id,
          expectedConnectionId: staleConnection.id,
        })
        .pipe(Effect.result);
      assert.strictEqual(stalePending._tag, "Failure");
      yield* repository.recover({
        authorizationId: aggregate.authorization.id,
        revoke: () => Effect.void,
      });
      assert.strictEqual(yield* repository.get(aggregate.authorization.id), null);
      const staleRemoved = yield* repository
        .connect({
          authorization: aggregate.authorization,
          connection: staleConnection,
          credential: aggregate.credential,
          expectedAuthorizationId: aggregate.authorization.id,
          expectedConnectionId: staleConnection.id,
        })
        .pipe(Effect.result);
      assert.strictEqual(staleRemoved._tag, "Failure");
      assert.strictEqual(yield* repository.get(aggregate.authorization.id), null);
    }).pipe(Effect.provide(layer));
  });
});
