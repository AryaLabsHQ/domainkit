import { assert, describe, expect, it } from "@effect/vitest";

import {
  AuthorizationLifecycle,
  Connection,
  ProviderAuthorization,
  Secret,
} from "../../src/index.ts";
import { InMemoryAuthorizationLifecycle } from "../../src/testing.ts";

const authenticate = async (): Promise<Connection.Authentication> => ({
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
    accessToken: Secret.make("token"),
    refreshToken: null,
    tokenType: "bearer",
  },
  expiresAt: null,
  providerAccountId: "account-1",
  providerContext: { value: {}, version: "example.v1" },
  scopes: ["dns:write"],
});

describe("Promise connections", () => {
  it("delegates token connections to the Effect lifecycle", async () => {
    const repository = AuthorizationLifecycle.toAsync(InMemoryAuthorizationLifecycle.make());
    const result = await Connection.start({
      authorizedById: "user-1",
      grant: { _tag: "account" },
      method: Connection.Method.Token({
        authenticate,
        providerId: "example",
        requiredCapabilities: ["dns:read", "dns:write"],
        token: Secret.make("token"),
      }),
      ownerId: "organization-1",
      repository,
    });
    assert.strictEqual(result._tag, "Connected");
    if (result._tag !== "Connected") return;
    assert.strictEqual(
      (await repository.get(result.aggregate.authorization.id))?.credential.accessToken.expose(),
      "token",
    );
  });

  it("fails loudly when required capability evidence is absent", async () => {
    await expect(
      Connection.start({
        authorizedById: "user-1",
        grant: { _tag: "account" },
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
        repository: AuthorizationLifecycle.toAsync(InMemoryAuthorizationLifecycle.make()),
      }),
    ).rejects.toMatchObject({ _tag: "ConnectionError" });
  });
});
