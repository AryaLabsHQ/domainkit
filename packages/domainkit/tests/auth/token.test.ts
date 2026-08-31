import { assert, describe, expect, it } from "@effect/vitest";

import { Connection, ManagedDnsConnections, Secret } from "../../src/promise.ts";
import * as ProviderAuthorization from "../../src/auth/authorization.ts";
import { InMemoryManagedDnsConnections } from "../../src/testing.ts";

const authenticate = async (token = "token"): Promise<Connection.Authentication> => ({
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
    refreshToken: null,
    tokenType: "bearer",
  },
  expiresAt: null,
  providerAccountId: "account-1",
  providerContext: { value: {}, version: "example.v1" },
  scopes: ["dns:write"],
});

describe("Promise connections", () => {
  it("persists a token connection and returns only its public projection", async () => {
    const repository = ManagedDnsConnections.toAsync(InMemoryManagedDnsConnections.make());
    const result = await Connection.start({
      authorizedById: "user-1",
      method: Connection.Method.Token({
        authenticate: (token) => authenticate(token.expose()),
        providerId: "example",
        requiredCapabilities: ["dns:read", "dns:write"],
        token: Secret.make("token"),
      }),
      ownerId: "organization-1",
      repository,
    });
    assert.strictEqual(result._tag, "Connected");
    if (result._tag !== "Connected") return;
    assert.deepStrictEqual(Object.keys(result.connection).sort(), [
      "createdAt",
      "id",
      "method",
      "ownerId",
      "providerId",
      "status",
    ]);
    const aggregate = await repository.getByConnectionId(result.connection.id);
    assert.strictEqual(aggregate?.credential.accessToken.expose(), "token");
    assert.strictEqual(aggregate?.connections.length, 1);
    assert.strictEqual(aggregate?.attachments.length, 0);
  });

  it("fails loudly when required capability evidence is absent", async () => {
    await expect(
      Connection.start({
        authorizedById: "user-1",
        method: Connection.Method.Token({
          authenticate: async () => ({
            ...(await authenticate()),
            capabilityEvidence: [],
          }),
          providerId: "example",
          requiredCapabilities: ["dns:write"],
          token: Secret.make("token"),
        }),
        ownerId: "organization-1",
        repository: ManagedDnsConnections.toAsync(InMemoryManagedDnsConnections.make()),
      }),
    ).rejects.toMatchObject({ _tag: "ConnectionError" });
  });
});
