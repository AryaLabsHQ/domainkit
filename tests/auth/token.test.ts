import { assert, describe, expect, it } from "@effect/vitest";

import {
  Connection,
  ConnectionLifecycle,
  DnsRecord,
  Provisioning,
  Secret,
  TokenConnection,
} from "../../src/index.ts";
import {
  InMemoryConnectionStore,
  InMemoryCredentialStore,
  InMemoryDnsProvider,
  InMemoryProviderAuthorizationStore,
} from "../../src/testing.ts";

describe("token connections", () => {
  it("validates caller tokens and authorizes a digest-bound DNS plan", async () => {
    const connections = InMemoryConnectionStore.toAsync();
    const credentialStore = InMemoryCredentialStore.make();
    const credentials = InMemoryCredentialStore.toAsync(credentialStore);
    const result = await TokenConnection.connect({
      authorizationStore: InMemoryProviderAuthorizationStore.toAsync(),
      connectionStore: connections,
      credentialStore: credentials,
      grant: { _tag: "account" },
      ownerId: "organization-1",
      providerId: "example-provider",
      subjectId: "user-1",
      token: Secret.make("personal-access-token"),
      validate: async (token) => {
        assert.strictEqual(token.expose(), "personal-access-token");
        return {
          accountId: "account-1",
          capabilities: ["dns:read", "dns:write"],
          expiresAt: null,
          scopes: ["dns:write"],
        };
      },
    });
    const { authorization, connection } = result;
    assert.strictEqual(
      Connection.assertGrant(connection, authorization, {
        capability: "dns:read",
        domain: "anything.example.com",
        providerId: "example-provider",
      }),
      "anything.example.com",
    );
    assert.notMatch(
      JSON.stringify(await credentials.get(authorization.id)),
      /personal-access-token/,
    );

    const provider = InMemoryDnsProvider.toAsync({ id: "example-provider" });
    const plan = await Provisioning.create({
      provider,
      requirements: [
        DnsRecord.parse({
          _tag: "TXT",
          metadata: { ownership: "example-app", provenance: "test", purpose: "Verify domain" },
          name: "_verify.example.com",
          policy: "append",
          ttl: 300,
          value: "verification",
        }),
      ],
      zone: "example.com",
    });

    await expect(
      Provisioning.authorizeForConnection({
        authorization: { ...authorization, id: "other-authorization" },
        connection,
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    const planAuthorization = await Provisioning.authorizeForConnection({
      authorization,
      connection,
      plan,
    });
    assert.strictEqual(planAuthorization.planDigest, plan.digest);

    await expect(
      Provisioning.authorizeForConnection({
        authorization: { ...authorization, capabilities: ["dns:read"] },
        connection,
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(
      Provisioning.authorizeForConnection({
        authorization: { ...authorization, expiresAt: new Date(0) },
        connection,
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(
      Provisioning.authorizeForConnection({
        authorization: { ...authorization, expiresAt: new Date(Number.NaN) },
        connection,
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
  });

  it("rejects invalid expiration metadata returned by token validation", async () => {
    await expect(
      TokenConnection.connect({
        authorizationStore: InMemoryProviderAuthorizationStore.toAsync(),
        connectionStore: InMemoryConnectionStore.toAsync(),
        credentialStore: InMemoryCredentialStore.toAsync(),
        grant: { _tag: "account" },
        ownerId: "organization-1",
        providerId: "example-provider",
        subjectId: "user-1",
        token: Secret.make("personal-access-token"),
        validate: async () => ({
          accountId: "account-1",
          capabilities: ["dns:read", "dns:write"],
          expiresAt: new Date(Number.NaN),
          scopes: ["dns:write"],
        }),
      }),
    ).rejects.toMatchObject({ _tag: "InvalidInputError" });
  });

  it("shares one provider authorization across owner bindings and revokes it last", async () => {
    const authorizationStore = InMemoryProviderAuthorizationStore.toAsync();
    const connectionStore = InMemoryConnectionStore.toAsync();
    const credentialStore = InMemoryCredentialStore.toAsync();
    const connect = (ownerId: string) =>
      TokenConnection.connect({
        authorizationStore,
        connectionStore,
        credentialStore,
        grant: { _tag: "account" },
        ownerId,
        providerId: "cloudflare",
        subjectId: `admin:${ownerId}`,
        token: Secret.make(`token:${ownerId}`),
        validate: async () => ({
          accountId: "cloudflare-account-1",
          capabilities: ["dns:read", "dns:write"],
          expiresAt: null,
          scopes: ["dns:write"],
        }),
      });
    const first = await connect("organization-1");
    const second = await connect("organization-2");
    assert.strictEqual(first.authorization.id, second.authorization.id);
    assert.notStrictEqual(first.connection.id, second.connection.id);
    assert.strictEqual(
      (await connectionStore.listByAuthorizationId(first.authorization.id)).length,
      2,
    );

    let revocations = 0;
    const detach = (connectionId: string) =>
      ConnectionLifecycle.detach({
        authorizationStore,
        connectionId,
        connectionStore,
        credentialStore,
        revokeAuthorization: async () => {
          revocations += 1;
        },
      });
    const firstDetach = await detach(first.connection.id);
    assert.deepStrictEqual(
      {
        remainingBindings: firstDetach.remainingBindings,
        revoked: firstDetach.revokedAuthorization,
      },
      { remainingBindings: 1, revoked: false },
    );
    assert.strictEqual(revocations, 0);
    assert.notStrictEqual(await credentialStore.get(first.authorization.id), null);

    const finalDetach = await detach(second.connection.id);
    assert.deepStrictEqual(
      {
        remainingBindings: finalDetach.remainingBindings,
        revoked: finalDetach.revokedAuthorization,
      },
      { remainingBindings: 0, revoked: true },
    );
    assert.strictEqual(revocations, 1);
    assert.strictEqual(await credentialStore.get(first.authorization.id), null);
    assert.strictEqual(await authorizationStore.get(first.authorization.id), null);
  });
});
