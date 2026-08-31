import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Connection, DnsProvider, DomainName, ProviderSession, Secret } from "../../src/index.ts";
import * as ProviderAuthorization from "../../src/auth/authorization.ts";
import * as CloudflareAuth from "../../src/providers/cloudflare/auth.ts";
import * as VercelAuth from "../../src/providers/vercel/auth.ts";
import { InMemoryDnsProvider } from "../../src/testing.ts";
import { page, zone } from "./cloudflare/fixtures.ts";
import { domain as vercelDomain, domainPage } from "./vercel/fixtures.ts";

const domain = DomainName.parse("example.com");
const target: Connection.ProviderTarget = {
  accountId: "account-1",
  accountKind: "account",
  evidence: {
    nameservers: [DomainName.parse("ada.ns.example.net")],
    status: "active",
    zoneType: "full",
  },
  zoneId: "zone-1",
  zoneName: domain,
};

describe("ProviderSession", () => {
  it.effect("adapts a Promise session and keeps target-bound DNS access focused", () => {
    const provider = InMemoryDnsProvider.toAsync({ id: "fake-provider" });
    const session = ProviderSession.fromAsync({
      forTarget: async () => provider,
      listTargets: async () => [target],
      providerId: "fake-provider",
      resolveTarget: async () => ProviderSession.Resolution.Resolved({ target }),
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* session.listTargets({ domain }), [target]);
      assert.deepStrictEqual(
        yield* session.resolveTarget(domain),
        ProviderSession.Resolution.Resolved({ target }),
      );
      const focused = yield* session.forTarget(target);
      assert.strictEqual(focused.id, "fake-provider");
      assert.deepStrictEqual(yield* focused.listRecords(domain), []);
    });
  });

  it("adapts the Effect session to the Promise facade", async () => {
    const provider = InMemoryDnsProvider.make({ id: "effect-provider" });
    const session = ProviderSession.toAsync({
      forTarget: () => Effect.succeed(provider),
      listTargets: () => Effect.succeed([target]),
      providerId: "effect-provider",
      resolveTarget: () => Effect.succeed(ProviderSession.Resolution.Resolved({ target })),
    });
    assert.deepStrictEqual(await session.listTargets(), [target]);
    assert.deepStrictEqual(
      await session.resolveTarget(domain),
      ProviderSession.Resolution.Resolved({ target }),
    );
    assert.deepStrictEqual(await (await session.forTarget(target)).listRecords(domain), []);
  });

  it.effect("preserves explicit resolution states and typed Promise failures", () => {
    const rejected = ProviderSession.fromAsync({
      forTarget: async () => {
        throw new Error("provider unavailable");
      },
      listTargets: async () => [],
      providerId: "fake-provider",
      resolveTarget: async () => ProviderSession.Resolution.NotFound({ domain }),
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* rejected.resolveTarget(domain),
        ProviderSession.Resolution.NotFound({ domain }),
      );
      const failure = yield* rejected.forTarget(target).pipe(Effect.flip);
      assert.ok(failure instanceof DnsProvider.Error);
      assert.strictEqual(failure.reason, "transport");
      assert.strictEqual(failure.operation, "ProviderSession.forTarget");
    });
  });

  it.effect("restores Cloudflare sessions only from active, capable authorization", () => {
    const authorization = cloudflareAuthorization();
    const credential = {
      accessToken: Secret.make("cloudflare-token"),
      expiresAt: null,
      refreshToken: null,
      tokenType: "bearer",
    } as const;
    const recording = {
      calls: 0,
      fetch: async () => {
        recording.calls += 1;
        return new Response(JSON.stringify(page([zone])), {
          headers: { "content-type": "application/json" },
        });
      },
    };
    return Effect.gen(function* () {
      const session = yield* CloudflareAuth.restore({
        authorization,
        credential,
        fetch: recording.fetch,
      });
      assert.strictEqual(session.providerId, "cloudflare");
      assert.strictEqual((yield* session.listTargets()).length, 1);
      assert.strictEqual(recording.calls, 1);

      for (const [name, invalid] of [
        [
          "pending revocation",
          { ...authorization, revocation: { _tag: "Pending", requestedAt: new Date() } },
        ],
        [
          "insufficient capability",
          {
            ...authorization,
            capabilityEvidence: authorization.capabilityEvidence.filter(
              ({ capability }) => capability === "dns:read",
            ),
          },
        ],
      ] as const) {
        const failure = yield* CloudflareAuth.restore({
          authorization: invalid,
          credential,
        }).pipe(Effect.flip);
        assert.strictEqual(failure.operation, "restore");
        assert.ok(failure.message.length > 0, name);
      }
      const expired = yield* CloudflareAuth.restore({
        authorization,
        credential: { ...credential, expiresAt: new Date("2020-01-01T00:00:00.000Z") },
      }).pipe(Effect.flip);
      assert.strictEqual(expired.reason, "authentication");
    });
  });

  it.effect("restores legacy Cloudflare account-token context for target discovery", () => {
    const recording = {
      fetch: async () =>
        new Response(JSON.stringify(page([zone])), {
          headers: { "content-type": "application/json" },
        }),
    };
    return Effect.gen(function* () {
      const session = yield* CloudflareAuth.restore({
        authorization: cloudflareAuthorization({
          method: "token",
          providerContext: {
            value: { tokenKind: "account" },
            version: "cloudflare.v1",
          },
        }),
        credential: {
          accessToken: Secret.make("cloudflare-token"),
          expiresAt: null,
          refreshToken: null,
          tokenType: "bearer",
        },
        fetch: recording.fetch,
      });
      const targets = yield* session.listTargets();
      assert.strictEqual(targets[0]?.accountId, "account-1");
    });
  });

  it.effect(
    "restores Vercel installation context and keeps target discovery credential-scoped",
    () => {
      const recording = {
        requests: [] as Array<string>,
        fetch: async (input: RequestInfo | URL) => {
          recording.requests.push(String(input));
          return new Response(JSON.stringify(domainPage([vercelDomain])), {
            headers: { "content-type": "application/json" },
          });
        },
      };
      return Effect.gen(function* () {
        const session = yield* VercelAuth.restore({
          authorization: vercelAuthorization(),
          credential: {
            accessToken: Secret.make("vercel-token"),
            expiresAt: null,
            refreshToken: null,
            tokenType: "bearer",
          },
          fetch: recording.fetch,
        });
        const targets = yield* session.listTargets();
        assert.strictEqual(session.providerId, "vercel");
        assert.strictEqual(targets[0]?.accountId, "team-1");
        assert.strictEqual(
          new URL(recording.requests[0] ?? "").searchParams.get("teamId"),
          "team-1",
        );
      });
    },
  );
});

function cloudflareAuthorization(
  overrides: Partial<ProviderSession.Authorization> = {},
): ProviderSession.Authorization {
  return {
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
    method: "oauth2",
    providerContext: { value: { tokenKind: "user" }, version: "cloudflare.v1" },
    providerId: "cloudflare",
    requiredCapabilities: ["dns:read", "dns:write"],
    revocation: { _tag: "Active" },
    ...overrides,
  };
}

function vercelAuthorization(): ProviderSession.Authorization {
  return {
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
    method: "integration",
    providerContext: {
      value: { _tag: "team", installationId: "icfg-1", teamId: "team-1" },
      version: "vercel.v1",
    },
    providerId: "vercel",
    requiredCapabilities: ["dns:read", "dns:write"],
    revocation: { _tag: "Active" },
  };
}
