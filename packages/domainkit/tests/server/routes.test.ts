import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";

import { Connection, Digest, Secret } from "../../src/index.ts";
import { Server } from "../../src/server.ts";
import { InMemoryManagedDnsConnections } from "../../src/testing.ts";

const pendingLayer = () =>
  Layer.effect(
    Server.PendingAuthorizations,
    Effect.gen(function* () {
      const state = yield* Ref.make<ReadonlyMap<string, Server.PendingAuthorization>>(new Map());
      return Server.PendingAuthorizations.of({
        consume: (id, now) =>
          Ref.modify(state, (entries) => {
            const value = entries.get(id);
            const next = new Map(entries);
            next.delete(id);
            return [
              value !== undefined && value.continuation.expiresAt > now ? value : null,
              next,
            ] as const;
          }),
        get: (id, now) =>
          Ref.get(state).pipe(
            Effect.map((entries) => {
              const value = entries.get(id);
              return value !== undefined && value.continuation.expiresAt > now ? value : null;
            }),
          ),
        put: (value) =>
          Ref.update(state, (entries) => {
            const next = new Map(entries);
            next.set(value.continuation.id, value);
            return next;
          }),
      });
    }),
  );

const providerLayer = Server.providersLayer([
  {
    create: ({ callbackUrl, domain }) => {
      if (domain === undefined) {
        return Effect.fail(
          new Server.Error({
            category: "provider",
            message: "Unsupported provider flow",
            operation: "TestProviders.interactiveFlow",
            retry: "never",
          }),
        );
      }
      return Effect.succeed({
        complete: (_payload, returnedUrl) => {
          if (returnedUrl.searchParams.get("code") !== "provider-code") {
            return Effect.fail(
              new Connection.Error({
                category: "authorization",
                message: "Provider code is missing",
                operation: "TestProvider.complete",
                retry: "after-user-action",
              }),
            );
          }
          return Effect.succeed({
            capabilityEvidence: [
              { capability: "dns:read" as const, evidence: { _tag: "Declared" as const } },
              { capability: "dns:write" as const, evidence: { _tag: "Declared" as const } },
            ],
            credential: {
              accessToken: Secret.make("provider-token"),
              refreshToken: null,
              tokenType: "bearer",
            },
            expiresAt: null,
            providerAccountId: "account-1",
            providerContext: { value: { domain }, version: "test.v1" },
            scopes: [],
          });
        },
        method: "oauth2" as const,
        providerId: "example",
        requiredCapabilities: ["dns:read" as const, "dns:write" as const],
        start: (continuationId) => {
          const authorizationUrl = new URL("https://provider.example/authorize");
          authorizationUrl.searchParams.set("redirect_uri", callbackUrl.toString());
          authorizationUrl.searchParams.set("state", continuationId);
          return Effect.succeed({
            authorizationUrl,
            payload: Secret.make(`payload:${continuationId}`),
          });
        },
      });
    },
    method: "oauth2",
    providerId: "example",
  },
]);

const identityLayer = Layer.succeed(Server.Identity)({
  authenticate: (request) =>
    request.headers.get("authorization") === "Bearer test-session"
      ? Effect.succeed({ authorizedById: "user-1", ownerId: "organization-1" })
      : Effect.fail(
          new Server.Error({
            category: "authentication",
            message: "Session required",
            operation: "TestIdentity.authenticate",
            retry: "after-user-action",
          }),
        ),
});

const policyLayer = Layer.succeed(Server.ConnectionPolicy)({
  authorizeReuse: ({ authorizationId }) =>
    authorizationId === "authorization-1"
      ? Effect.void
      : Effect.fail(
          new Server.Error({
            category: "authorization",
            message: "Authorization is not available to this principal",
            operation: "TestConnectionPolicy.authorizeReuse",
            retry: "never",
          }),
        ),
});

const makeHandler = (
  options: {
    readonly basePath?: string;
    readonly pending?: Layer.Layer<Server.PendingAuthorizations>;
  } = {},
) => {
  const dependencies = Layer.mergeAll(
    identityLayer,
    policyLayer,
    providerLayer,
    options.pending ?? pendingLayer(),
    InMemoryManagedDnsConnections.layer(),
    Digest.webCryptoLayer,
  );
  return Server.toWebHandler(
    Server.layer({
      baseURL: "https://app.example",
      ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
      defaultReturnTo: "/domains",
    }).pipe(Layer.provide(dependencies)),
  );
};

describe("DomainKit server routes", () => {
  it("mounts one interactive start and callback flow", async () => {
    const handler = makeHandler();
    try {
      const start = await handler.fetch(
        new Request("https://internal.example/api/domainkit/connection/start", {
          body: JSON.stringify({
            domain: "mail.example.com",
            method: "oauth2",
            providerId: "example",
            returnTo: "/domains/domain-1?tab=dns",
          }),
          headers: { authorization: "Bearer test-session", "content-type": "application/json" },
          method: "POST",
        }),
      );
      assert.strictEqual(start.status, 200);
      const body = (await start.json()) as {
        readonly authorizationUrl: string;
        readonly continuationId: string;
      };
      const authorizationUrl = new URL(body.authorizationUrl);
      assert.strictEqual(authorizationUrl.searchParams.get("state"), body.continuationId);
      assert.strictEqual(
        authorizationUrl.searchParams.get("redirect_uri"),
        "https://app.example/api/domainkit/callback/example",
      );

      const callback = await handler.fetch(
        new Request(
          `https://app.example/api/domainkit/callback/example?state=${body.continuationId}&code=provider-code`,
        ),
      );
      assert.strictEqual(callback.status, 303);
      const destination = new URL(callback.headers.get("location") ?? "");
      assert.strictEqual(destination.pathname, "/domains/domain-1");
      assert.strictEqual(destination.searchParams.get("tab"), "dns");
      assert.strictEqual(destination.searchParams.get("domainkit"), "connected");
      assert.ok(destination.searchParams.get("connectionId"));

      const replay = await handler.fetch(
        new Request(
          `https://app.example/api/domainkit/callback/example?state=${body.continuationId}&code=provider-code`,
        ),
      );
      assert.strictEqual(replay.status, 400);
      assert.match(await replay.text(), /expired, unknown, or already consumed/);
    } finally {
      await handler.dispose();
    }
  });

  it("rejects unauthenticated starts and cross-origin return targets", async () => {
    const handler = makeHandler();
    try {
      const unauthenticated = await handler.fetch(
        new Request("https://app.example/api/domainkit/connection/start", {
          body: JSON.stringify({
            domain: "mail.example.com",
            method: "oauth2",
            providerId: "example",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      assert.strictEqual(unauthenticated.status, 401);

      const openRedirect = await handler.fetch(
        new Request("https://app.example/api/domainkit/connection/start", {
          body: JSON.stringify({
            domain: "mail.example.com",
            method: "oauth2",
            providerId: "example",
            returnTo: "https://attacker.example/steal",
          }),
          headers: { authorization: "Bearer test-session", "content-type": "application/json" },
          method: "POST",
        }),
      );
      assert.strictEqual(openRedirect.status, 400);
      assert.match(await openRedirect.text(), /same-origin|configured application origin/);
    } finally {
      await handler.dispose();
    }
  });

  it("requires host authorization before reusing an authorization aggregate", async () => {
    const handler = makeHandler();
    try {
      const response = await handler.fetch(
        new Request("https://app.example/api/domainkit/connection/start", {
          body: JSON.stringify({
            authorizationId: "another-tenant-authorization",
            domain: "mail.example.com",
            method: "oauth2",
            providerId: "example",
          }),
          headers: { authorization: "Bearer test-session", "content-type": "application/json" },
          method: "POST",
        }),
      );
      assert.strictEqual(response.status, 403);
      assert.match(await response.text(), /not available to this principal/);
    } finally {
      await handler.dispose();
    }
  });

  it("supports mounting the handler at the application root", async () => {
    const handler = makeHandler({ basePath: "/" });
    try {
      const start = await handler.fetch(
        new Request("https://app.example/connection/start", {
          body: JSON.stringify({
            domain: "mail.example.com",
            method: "oauth2",
            providerId: "example",
          }),
          headers: { authorization: "Bearer test-session", "content-type": "application/json" },
          method: "POST",
        }),
      );
      assert.strictEqual(start.status, 200);
      const body = (await start.json()) as {
        readonly authorizationUrl: string;
        readonly continuationId: string;
      };
      assert.strictEqual(
        new URL(body.authorizationUrl).searchParams.get("redirect_uri"),
        "https://app.example/callback/example",
      );

      const callback = await handler.fetch(
        new Request(
          `https://app.example/callback/example?state=${body.continuationId}&code=provider-code`,
        ),
      );
      assert.strictEqual(callback.status, 303);
    } finally {
      await handler.dispose();
    }
  });

  it("reports pending-state infrastructure failures as unavailable", async () => {
    const unavailablePending = Layer.succeed(Server.PendingAuthorizations)({
      consume: () => Effect.succeed(null),
      get: () => Effect.succeed(null),
      put: () =>
        Effect.fail(
          new Server.Error({
            category: "storage",
            message: "Pending authorization store is unavailable",
            operation: "TestPending.put",
            retry: "safe",
          }),
        ),
    });
    const handler = makeHandler({ pending: unavailablePending });
    try {
      const response = await handler.fetch(
        new Request("https://app.example/api/domainkit/connection/start", {
          body: JSON.stringify({
            domain: "mail.example.com",
            method: "oauth2",
            providerId: "example",
          }),
          headers: { authorization: "Bearer test-session", "content-type": "application/json" },
          method: "POST",
        }),
      );
      assert.strictEqual(response.status, 503);
      assert.match(await response.text(), /store is unavailable/);
    } finally {
      await handler.dispose();
    }
  });

  it("rejects callbacks routed through another provider", async () => {
    const handler = makeHandler();
    try {
      const start = await handler.fetch(
        new Request("https://app.example/api/domainkit/connection/start", {
          body: JSON.stringify({
            domain: "mail.example.com",
            method: "oauth2",
            providerId: "example",
          }),
          headers: { authorization: "Bearer test-session", "content-type": "application/json" },
          method: "POST",
        }),
      );
      const { continuationId } = (await start.json()) as { readonly continuationId: string };
      const wrongOrigin = await handler.fetch(
        new Request(
          `https://attacker.example/api/domainkit/callback/example?state=${continuationId}&code=provider-code`,
        ),
      );
      assert.strictEqual(wrongOrigin.status, 400);
      assert.match(await wrongOrigin.text(), /URL is invalid/);

      const mismatch = await handler.fetch(
        new Request(
          `https://app.example/api/domainkit/callback/other?state=${continuationId}&code=provider-code`,
        ),
      );
      assert.strictEqual(mismatch.status, 400);
      assert.match(await mismatch.text(), /does not match/);
    } finally {
      await handler.dispose();
    }
  });
});
