import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Connection, Diagnostic, Secret } from "../../src/index.ts";
import * as ProviderAuthorization from "../../src/auth/authorization.ts";
import type * as ConnectionModel from "../../src/auth/connection.ts";

describe("provider authorization internals", () => {
  it.effect("round-trips evidence and versioned provider context", () =>
    Effect.gen(function* () {
      const authorization: ProviderAuthorization.ProviderAuthorization = {
        authorizedById: "user-1",
        capabilityEvidence: [
          {
            capability: "dns:read",
            evidence: ProviderAuthorization.Evidence.Introspected({
              observedAt: new Date("2026-08-29T00:00:00.000Z"),
            }),
          },
          {
            capability: "dns:write",
            evidence: ProviderAuthorization.Evidence.Exercised({
              observedAt: new Date("2026-08-29T00:01:00.000Z"),
            }),
          },
        ],
        createdAt: new Date("2026-08-29T00:00:00.000Z"),
        id: "authorization-1",
        method: "integration",
        providerContext: {
          value: { installationId: "icfg_1", teamId: "team-1" },
          version: "vercel.v1",
        },
        providerId: "vercel",
        requiredCapabilities: ["dns:read", "dns:write"],
        revocation: { _tag: "Active" },
        scopes: [],
      };
      const encoded = ProviderAuthorization.encode(authorization);
      const decoded = yield* ProviderAuthorization.decode(encoded);
      assert.deepStrictEqual(decoded, authorization);
      assert.strictEqual(
        ProviderAuthorization.evidenceFor(decoded, "dns:write")?._tag,
        "Exercised",
      );
    }),
  );

  it("projects safe diagnostics without exposing the authorization aggregate", () => {
    const error = Connection.authorizationError(
      "Domain attachment expired",
      "Connection.assertAttachment",
    );
    assert.deepStrictEqual(Diagnostic.from(error), {
      category: "authorization",
      message: "Domain attachment expired",
      operation: "Connection.assertAttachment",
      retry: "after-user-action",
      tag: "AuthorizationError",
    });
  });

  it("projects expired credentials as active only when they remain refreshable", () => {
    const authorization: ProviderAuthorization.ProviderAuthorization = {
      authorizedById: "user-1",
      capabilityEvidence: [],
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      id: "authorization-1",
      method: "oauth2",
      providerContext: { value: {}, version: "cloudflare.v1" },
      providerId: "cloudflare",
      requiredCapabilities: [],
      revocation: { _tag: "Active" },
      scopes: [],
    };
    const connection: ConnectionModel.StoredConnection = {
      authorizationId: authorization.id,
      createdAt: authorization.createdAt,
      id: "connection-1",
      method: "oauth2",
      ownerId: "organization-1",
      providerId: "cloudflare",
    };
    const expiredAt = new Date("2026-08-29T00:30:00.000Z");
    const now = new Date("2026-08-29T01:00:00.000Z");
    const base = {
      accessToken: Secret.make("access-token"),
      expiresAt: expiredAt,
      tokenType: "bearer",
    } as const;
    assert.strictEqual(
      Connection.project(connection, authorization, { ...base, refreshToken: null }, now).status,
      "expired",
    );
    assert.strictEqual(
      Connection.project(
        connection,
        authorization,
        { ...base, refreshToken: Secret.make("refresh-token") },
        now,
      ).status,
      "active",
    );
  });
});
