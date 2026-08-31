import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  Connection,
  ConnectionAuthorization,
  DnsProvider,
  DnsRecord,
  Digest,
  ManagedDnsConnections,
  Provisioning,
  Secret,
} from "../../src/index.ts";
import * as ProviderAuthorization from "../../src/auth/authorization.ts";
import * as ConnectionModel from "../../src/auth/connection.ts";
import * as DomainName from "../../src/domain/domain-name.ts";
import { InMemoryDnsProvider, InMemoryManagedDnsConnections } from "../../src/testing.ts";

const authorization: ProviderAuthorization.ProviderAuthorization = {
  authorizedById: "user-1",
  capabilityEvidence: [
    { capability: "dns:read", evidence: ProviderAuthorization.Evidence.Declared() },
    { capability: "dns:write", evidence: ProviderAuthorization.Evidence.Declared() },
  ],
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  expiresAt: null,
  id: "authorization-1",
  method: "oauth2",
  providerContext: { value: {}, version: "test.v1" },
  providerId: "test",
  requiredCapabilities: ["dns:read", "dns:write"],
  revocation: { _tag: "Active" },
  scopes: ["dns:read", "dns:write"],
};

const connection: Connection.ProviderConnection = {
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  id: "connection-1",
  method: "oauth2",
  ownerId: "organization-1",
  providerId: "test",
  status: "active",
};

const attachment: Connection.DomainAttachment = {
  connectionId: connection.id,
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  domain: DomainName.parse("mail.example.com"),
  id: "attachment-1",
  target: {
    accountId: "account-1",
    accountKind: "account",
    zoneId: "zone-1",
    zoneName: DomainName.parse("example.com"),
  },
};

const planFor = (name: string) =>
  Provisioning.create({
    requirements: [
      DnsRecord.parse({
        _tag: "TXT",
        metadata: { ownership: "customer", provenance: "test", purpose: "verification" },
        name,
        policy: "append",
        ttl: 300,
        value: "proof",
      }),
    ],
    target: Provisioning.Target.ExactZone({ zone: "example.com" }),
  });

describe("connection authorization", () => {
  it.effect("authorizes a plan within the exact attached provider zone", () => {
    const provider = InMemoryDnsProvider.make({ id: authorization.providerId });
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(DnsProvider.Service, provider),
      Layer.merge(Layer.succeed(ManagedDnsConnections.Service, repository), Digest.webCryptoLayer),
    );
    return Effect.gen(function* () {
      yield* repository.connect({
        authorization,
        connection: { ...connection, authorizationId: authorization.id },
        credential: {
          accessToken: Secret.make("token"),
          refreshToken: null,
          tokenType: "bearer",
        },
      });
      yield* repository.attach({
        attachment,
        connectionId: connection.id,
        ownerId: connection.ownerId,
      });
      const { plan } = yield* planFor("mail.example.com");
      const approved = yield* ConnectionAuthorization.authorize({
        authorization,
        attachment,
        connection,
        domain: attachment.domain,
        plan,
      });
      assert.strictEqual(approved.planDigest, plan.digest);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects operations outside the attached domain", () => {
    const provider = InMemoryDnsProvider.make({ id: authorization.providerId });
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(DnsProvider.Service, provider),
      Layer.merge(Layer.succeed(ManagedDnsConnections.Service, repository), Digest.webCryptoLayer),
    );
    return Effect.gen(function* () {
      yield* repository.connect({
        authorization,
        connection: { ...connection, authorizationId: authorization.id },
        credential: {
          accessToken: Secret.make("token"),
          refreshToken: null,
          tokenType: "bearer",
        },
      });
      yield* repository.attach({
        attachment,
        connectionId: connection.id,
        ownerId: connection.ownerId,
      });
      const { plan } = yield* planFor("other.example.com");
      const failure = yield* Effect.flip(
        ConnectionAuthorization.authorize({
          authorization,
          attachment,
          connection,
          domain: attachment.domain,
          plan,
        }),
      );
      assert.strictEqual(failure._tag, "AuthorizationError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("requires the attachment to exist on the persisted owner connection", () => {
    const provider = InMemoryDnsProvider.make({ id: authorization.providerId });
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(DnsProvider.Service, provider),
      Layer.merge(Layer.succeed(ManagedDnsConnections.Service, repository), Digest.webCryptoLayer),
    );
    return Effect.gen(function* () {
      yield* repository.connect({
        authorization,
        connection: { ...connection, authorizationId: authorization.id },
        credential: {
          accessToken: Secret.make("token"),
          refreshToken: null,
          tokenType: "bearer",
        },
      });
      const { plan } = yield* planFor("mail.example.com");
      const failure = yield* Effect.flip(
        ConnectionAuthorization.authorize({
          authorization,
          attachment: { ...attachment, id: "missing-attachment" },
          connection,
          domain: attachment.domain,
          plan,
        }),
      );
      assert.strictEqual(failure._tag, "AuthorizationError");
    }).pipe(Effect.provide(layer));
  });

  it("rejects a mismatched connection or attachment", () => {
    assert.throws(() =>
      ConnectionModel.assertAttachment({
        attachment,
        authorization,
        capability: "dns:write",
        connection: { ...connection, id: "another-connection" },
        domain: attachment.domain,
        providerId: connection.providerId,
      }),
    );
  });
});
