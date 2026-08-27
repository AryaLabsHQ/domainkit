import { assert, describe, expect, it } from "@effect/vitest";

import { Connection, DnsRecord, Provisioning, Secret, TokenConnection } from "../../src/index.ts";
import {
  InMemoryConnectionStore,
  InMemoryCredentialStore,
  InMemoryDnsProvider,
} from "../../src/testing.ts";

describe("token connections", () => {
  it("validates caller tokens and authorizes a digest-bound DNS plan", async () => {
    const connections = InMemoryConnectionStore.toAsync();
    const credentialStore = InMemoryCredentialStore.make();
    const credentials = InMemoryCredentialStore.toAsync(credentialStore);
    const connection = await TokenConnection.connect({
      connectionStore: connections,
      credentialStore: credentials,
      grant: { _tag: "account" },
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
    assert.strictEqual(
      Connection.assertGrant(connection, {
        accountId: "account-1",
        capability: "dns:read",
        domain: "anything.example.com",
        providerId: "example-provider",
      }),
      "anything.example.com",
    );
    assert.notMatch(JSON.stringify(await credentials.get(connection.id)), /personal-access-token/);

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
        accountId: "wrong-account",
        connection,
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    const authorization = await Provisioning.authorizeForConnection({
      accountId: "account-1",
      connection,
      plan,
    });
    assert.strictEqual(authorization.planDigest, plan.digest);

    await expect(
      Provisioning.authorizeForConnection({
        accountId: "account-1",
        connection: { ...connection, capabilities: ["dns:read"] },
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(
      Provisioning.authorizeForConnection({
        accountId: "account-1",
        connection: { ...connection, expiresAt: new Date(0) },
        plan,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
  });
});
