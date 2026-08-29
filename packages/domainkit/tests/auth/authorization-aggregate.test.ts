import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Connection, Diagnostic, ProviderAuthorization } from "../../src/effect.ts";

describe("authorization aggregate model", () => {
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
        expiresAt: null,
        id: "authorization-1",
        method: "integration",
        providerAccountId: "team-1",
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

  it("projects safe shared diagnostics from precise tagged errors", () => {
    const error = Connection.authorizationError("Grant expired", "Connection.assertGrant");
    assert.deepStrictEqual(Diagnostic.from(error), {
      category: "authorization",
      message: "Grant expired",
      operation: "Connection.assertGrant",
      retry: "after-user-action",
      tag: "AuthorizationError",
    });
  });
});
