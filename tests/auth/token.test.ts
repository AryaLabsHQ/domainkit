import { describe, expect, it } from "vitest";

import {
  assertConnectionGrant,
  authorizePlanForConnection,
  connectToken,
  createPlan,
  parseDnsRecord,
  Secret,
} from "../../src/index.ts";
import {
  InMemoryConnectionStore,
  InMemoryCredentialStore,
  InMemoryDnsProvider,
} from "../../src/testing.ts";

describe("token connections", () => {
  it("validates caller tokens and enforces account-wide grants", async () => {
    const credentialStore = new InMemoryCredentialStore();
    const connection = await connectToken({
      connectionStore: new InMemoryConnectionStore().promise,
      credentialStore: credentialStore.promise,
      grant: { _tag: "account" },
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      providerId: "example-provider",
      subjectId: "user-1",
      token: Secret.from("personal-access-token"),
      validate: async (token) => {
        expect(token.expose()).toBe("personal-access-token");
        return {
          accountId: "account-1",
          capabilities: ["dns:read", "dns:write"],
          expiresAt: null,
          scopes: ["dns:write"],
        };
      },
    });
    expect(
      assertConnectionGrant(connection, {
        accountId: "account-1",
        capability: "dns:read",
        domain: "anything.example.com",
        providerId: "example-provider",
      }),
    ).toBe("anything.example.com");
    expect(JSON.stringify(await credentialStore.promise.get(connection.id))).not.toContain(
      "personal-access-token",
    );

    const provider = new InMemoryDnsProvider({ id: "example-provider" });
    const plan = await createPlan({
      provider: provider.promise,
      requirements: [
        parseDnsRecord({
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
      authorizePlanForConnection({ accountId: "wrong-account", connection, plan }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(
      authorizePlanForConnection({ accountId: "account-1", connection, plan }),
    ).resolves.toMatchObject({ planDigest: plan.digest });
    await expect(
      authorizePlanForConnection({
        accountId: "account-1",
        connection: { ...connection, capabilities: ["dns:read"] },
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(
      authorizePlanForConnection({
        accountId: "account-1",
        connection: { ...connection, expiresAt: "2026-08-26T00:00:00.000Z" },
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(
      authorizePlanForConnection({
        accountId: "account-1",
        connection: { ...connection, expiresAt: "not-a-date" },
        plan,
      }),
    ).rejects.toMatchObject({
      _tag: "AuthorizationError",
      message: "Connection expiration is invalid",
    });
  });
});
