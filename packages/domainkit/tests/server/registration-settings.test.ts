import { assert, describe, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Layer, Redacted, Schema } from "effect";

import { Cloudflare, Custody, DomainKit, Provider, Storage, Vercel } from "../../src/index.ts";
import { Server } from "../../src/entry/server.ts";
import { Testing } from "../../src/entry/testing.ts";
import { page } from "../providers/cloudflare/fixtures.ts";
import { recordedFetch } from "../providers/recorded-fetch.ts";

const callbackBaseUrl = "https://public.example/api/dns/";
const unavailable = Config.fail(new ConfigProvider.SourceError({ message: "secret-canary" }));
const missingSecret = unavailable as Config.Config<Redacted.Redacted<string>>;

const mounted = (definition: Provider.Definition, base = callbackBaseUrl) => {
  const memory = Storage.makeMemory();
  const writes: Array<Storage.Continuation> = [];
  const storage: Storage.Interface = {
    ...memory,
    continuations: {
      ...memory.continuations,
      put: (continuation) =>
        Effect.suspend(() => {
          writes.push(continuation);
          return memory.continuations.put(continuation);
        }),
    },
  };
  const services = DomainKit.layer({ providers: [definition], resolver: Testing.resolver() }).pipe(
    Layer.provideMerge(Layer.succeed(Storage.Service)(storage)),
    Layer.provide(Custody.layer({ key: Redacted.make(Custody.generateKey()) })),
    Layer.merge(
      Layer.succeed(Server.Identity)({ principal: () => Effect.succeed(Testing.principal) }),
    ),
  );
  const web = Server.toWebHandler(services, {
    prefix: "/api/dns",
    callbackBaseUrl: base,
    defaultReturnTo: "/settings/domains",
  });
  const start = () =>
    web.handler(
      new Request("http://private.internal/api/dns/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: definition.id,
          method: { _tag: definition.auth.oauth === undefined ? "Integration" : "OAuth" },
        }),
      }),
    );
  return { ...web, writes, start };
};

describe("offline registration settings", () => {
  it.effect("returns no settings for token-only providers, without any services", () =>
    Server.registrationSettings({
      providers: [Cloudflare.provider(), Vercel.provider()],
      callbackBaseUrl,
    }).pipe(Effect.map((settings) => assert.deepStrictEqual(settings, []))),
  );

  for (const clientAuth of ["none", "client_secret_basic", "client_secret_post"] as const) {
    it(`matches Cloudflare ${clientAuth} mounted start and exchange, including confidential PKCE`, async () => {
      const recording = recordedFetch([
        {
          body: { access_token: "access-canary", token_type: "bearer" },
          expect: { method: "POST", pathname: "/cloudflare/oauth2/token" },
        },
        { body: page([]) },
      ]);
      const definition = Cloudflare.provider({
        fetch: recording.fetch,
        baseUrl: "http://localhost:4000/cloudflare/client/v4",
        oauth: {
          clientId: "client-canary",
          ...(clientAuth === "none"
            ? { clientAuth }
            : { clientAuth, clientSecret: Redacted.make("secret-canary") }),
          scopes: ["custom.read", "offline_access"],
          issuer: "http://emulator.localhost:4000/cloudflare/",
          serverOrigin: "http://host.docker.internal:4000/cloudflare/",
          allowPlaintext: true,
        },
      });
      const settings = await Effect.runPromise(
        Server.registrationSettings({ providers: [definition], callbackBaseUrl }),
      );
      assert.deepStrictEqual(settings, [
        {
          _tag: "OAuth",
          provider: "cloudflare",
          callbackUrl: "https://public.example/api/dns/callback/cloudflare",
          clientAuth,
          pkce: "S256",
          scopes: ["custom.read", "offline_access"],
        },
      ]);
      assert.ok(Schema.is(Schema.Array(Server.RegistrationSettings))(settings));
      const serialized = JSON.stringify(settings);
      for (const canary of [
        "client-canary",
        "secret-canary",
        "access-canary",
        "localhost",
        "internal",
        "issuer",
        "state",
        "codeVerifier",
      ])
        assert.ok(!serialized.includes(canary));
      const web = mounted(definition);
      try {
        const response = await web.start();
        assert.strictEqual(response.status, 200);
        const { authorizationUrl } = (await response.json()) as Server.Redirect;
        const consent = new URL(authorizationUrl);
        assert.strictEqual(
          consent.origin + consent.pathname,
          "http://emulator.localhost:4000/cloudflare/oauth2/auth",
        );
        assert.strictEqual(consent.searchParams.get("redirect_uri"), settings[0]?.callbackUrl);
        assert.strictEqual(consent.searchParams.get("scope"), "custom.read offline_access");
        assert.strictEqual(consent.searchParams.get("code_challenge_method"), "S256");
        assert.ok(consent.searchParams.get("code_challenge"));
        assert.strictEqual(web.writes.length, 1);
        const state = consent.searchParams.get("state") ?? "";
        const callback = await web.handler(
          new Request(
            `http://private.internal/api/dns/callback/cloudflare?state=${state}&code=code-1`,
          ),
        );
        assert.strictEqual(callback.status, 302, await callback.text());
        const exchange = recording.requests[0];
        assert.strictEqual(
          exchange?.url,
          "http://host.docker.internal:4000/cloudflare/oauth2/token",
        );
        const body = new URLSearchParams(String(exchange?.init?.body));
        assert.strictEqual(body.get("redirect_uri"), settings[0]?.callbackUrl);
        assert.ok(body.get("code_verifier"));
        const authorization = new Headers(exchange?.init?.headers).get("authorization");
        if (clientAuth === "client_secret_basic") assert.ok(authorization?.startsWith("Basic "));
        else assert.strictEqual(authorization, null);
        assert.strictEqual(
          body.get("client_secret"),
          clientAuth === "client_secret_post" ? "secret-canary" : null,
        );
      } finally {
        await web.dispose();
      }
    });
  }

  it("matches Vercel settings with the mounted host-started callback and exchange", async () => {
    const recording = recordedFetch([
      {
        body: { access_token: "token", team_id: "team-1", user_id: "user-1" },
        expect: { method: "POST", pathname: "/v2/oauth/access_token" },
      },
    ]);
    const definition = Vercel.provider({
      fetch: recording.fetch,
      integration: { clientId: "client", clientSecret: Redacted.make("secret"), slug: "domainkit" },
    });
    const settings = await Effect.runPromise(
      Server.registrationSettings({ providers: [definition], callbackBaseUrl }),
    );
    const web = mounted(definition);
    try {
      const response = await web.start();
      assert.strictEqual(response.status, 200);
      const { authorizationUrl } = (await response.json()) as Server.Redirect;
      const install = new URL(authorizationUrl);
      assert.strictEqual(
        install.origin + install.pathname,
        "https://vercel.com/integrations/domainkit/new",
      );
      assert.strictEqual(install.searchParams.get("source"), "external");
      const state = install.searchParams.get("state") ?? "";
      const callback = await web.handler(
        new Request(
          `http://private.internal/api/dns/callback/vercel?state=${state}&code=code-1&teamId=team-1`,
        ),
      );
      assert.strictEqual(callback.status, 302, await callback.text());
      const body = new URLSearchParams(String(recording.requests[0]?.init?.body));
      assert.strictEqual(body.get("redirect_uri"), settings[0]?.callbackUrl);
      assert.strictEqual(body.get("client_secret"), "secret");
      assert.strictEqual(web.writes.length, 1);
    } finally {
      await web.dispose();
    }
  });

  it.effect("requires custom Integration registration metadata", () => {
    const definition = Vercel.provider({
      integration: { clientId: "c", clientSecret: Redacted.make("s"), slug: "domainkit" },
    });
    const auth = definition.auth.integration;
    assert.ok(auth);
    const { registration: _registration, ...integration } = auth;
    return Server.registrationSettings({
      providers: [{ ...definition, auth: { integration } }],
      callbackBaseUrl,
    }).pipe(
      Effect.flip,
      Effect.map((error) => assert.strictEqual(error.reason._tag, "Unsupported")),
    );
  });

  it.effect("preserves Promise provider metadata without calling its operations", () => {
    const unused = async (): Promise<never> => {
      throw new Error("Registration must not call provider operations");
    };
    const definition = Provider.fromAsync({
      id: "custom",
      name: "Custom",
      context: Schema.Struct({}),
      contextVersion: "custom.v1",
      auth: {
        oauth: {
          label: "OAuth",
          registration: { clientAuth: "none", pkce: "S256" },
          scopes: ["custom"],
          start: unused,
          complete: unused,
          refresh: unused,
        },
        integration: {
          label: "Integration",
          registration: { clientAuth: "client_secret_post" },
          start: unused,
          complete: unused,
        },
      },
      session: () => {
        throw new Error("Registration must not create a session");
      },
    });
    return Server.registrationSettings({ providers: [definition], callbackBaseUrl }).pipe(
      Effect.map((settings) =>
        assert.deepStrictEqual(
          settings.map((s) => s._tag),
          ["OAuth", "Integration"],
        ),
      ),
    );
  });

  it("describes Vercel without resolving credentials and re-resolves them after rotation", async () => {
    let secret = "start-secret";
    const currentSecret = Config.Redacted("VERCEL_SECRET");
    const recording = recordedFetch([
      {
        body: {
          access_token: "access-1",
          team_id: "team-1",
          user_id: "user-1",
          token_type: "bearer",
        },
        expect: { method: "POST", pathname: "/vercel/v2/oauth/access_token" },
      },
    ]);
    const definition = Vercel.provider({
      fetch: recording.fetch,
      baseUrl: "http://localhost:4000/vercel",
      integration: {
        clientId: "client-canary",
        clientSecret: currentSecret,
        slug: "domainkit",
        installOrigin: "http://localhost:4000/vercel/",
      },
    });
    const settings = await Effect.runPromise(
      Server.registrationSettings({ providers: [definition], callbackBaseUrl }),
    );
    assert.deepStrictEqual(settings, [
      {
        _tag: "Integration",
        provider: "vercel",
        callbackUrl: "https://public.example/api/dns/callback/vercel",
        clientAuth: "client_secret_post",
      },
    ]);
    const provider = ConfigProvider.fromUnknown({ VERCEL_SECRET: secret });
    const auth = definition.auth.integration;
    assert.ok(auth);
    const started = await Effect.runPromise(
      auth
        .start({ state: "state-1", callbackUrl: settings[0]?.callbackUrl ?? "" })
        .pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
    );
    assert.strictEqual(
      started.authorizationUrl,
      "http://localhost:4000/vercel/integrations/domainkit/new?source=external&state=state-1",
    );
    assert.deepStrictEqual(recording.requests, []);
    secret = "rotated-secret";
    await Effect.runPromise(
      auth
        .complete({
          code: "code-1",
          callbackUrl: settings[0]?.callbackUrl ?? "",
          params: { teamId: "team-1" },
        })
        .pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({ VERCEL_SECRET: secret }),
          ),
        ),
    );
    const body = new URLSearchParams(String(recording.requests[0]?.init?.body));
    assert.strictEqual(body.get("client_secret"), "rotated-secret");
    assert.strictEqual(body.get("redirect_uri"), settings[0]?.callbackUrl);
  });

  it.effect("needs no credentials to describe a configured confidential client", () =>
    Server.registrationSettings({
      providers: [
        Cloudflare.provider({
          oauth: { clientId: unavailable as Config.Config<string>, clientSecret: missingSecret },
        }),
        Vercel.provider({
          integration: {
            clientId: unavailable as Config.Config<string>,
            clientSecret: missingSecret,
            slug: "domainkit",
          },
        }),
      ],
      callbackBaseUrl,
    }).pipe(Effect.map((settings) => assert.strictEqual(settings.length, 2))),
  );

  it.effect("fails Unsupported for custom interactive methods without metadata", () =>
    Server.registrationSettings({
      providers: [Testing.provider({ oauth: true })],
      callbackBaseUrl,
    }).pipe(
      Effect.flip,
      Effect.map((error) => {
        assert.strictEqual(error.reason._tag, "Unsupported");
        if (error.reason._tag === "Unsupported")
          assert.strictEqual(error.reason.operation, "registrationSettings");
      }),
    ),
  );

  for (const base of [
    "",
    "secret-canary",
    "ftp://public.example",
    "https://public.example?",
    "https://public.example#",
    "https://secret-canary@public.example",
    "https://public.example?secret-canary",
    "https://public.example#secret-canary",
  ]) {
    it(`refuses an invalid public callback base ${JSON.stringify(base)}`, async () => {
      const definition = Vercel.provider({
        integration: { clientId: "c", clientSecret: Redacted.make("s"), slug: "domainkit" },
      });
      const error = await Effect.runPromise(
        Server.registrationSettings({ providers: [definition], callbackBaseUrl: base }).pipe(
          Effect.flip,
        ),
      );
      assert.strictEqual(error.reason._tag, "InvalidInput");
      assert.ok(!JSON.stringify(error).includes("secret-canary"));
      const web = mounted(definition, base);
      try {
        const response = await web.start();
        assert.strictEqual(response.status, 400);
        assert.deepStrictEqual(web.writes, []);
      } finally {
        await web.dispose();
      }
    });
  }
});

const malformed: ReadonlyArray<{
  field: string;
  definition: (fetch: import("../../src/internal/http.ts").Fetch) => Provider.Definition;
}> = [
  {
    field: "oauth.clientId",
    definition: (fetch) =>
      Cloudflare.provider({ fetch, oauth: { clientId: Config.succeed(""), clientAuth: "none" } }),
  },
  {
    field: "oauth.clientId",
    definition: (fetch) =>
      Cloudflare.provider({
        fetch,
        oauth: { clientId: 123, clientAuth: "none" } as unknown as Cloudflare.OAuthOptions,
      }),
  },
  {
    field: "oauth.issuer",
    definition: (fetch) =>
      Cloudflare.provider({
        fetch,
        oauth: {
          clientId: "c",
          clientAuth: "none",
          issuer: 123,
        } as unknown as Cloudflare.OAuthOptions,
      }),
  },
  {
    field: "integration.installOrigin",
    definition: (fetch) =>
      Vercel.provider({
        fetch,
        integration: {
          clientId: "c",
          clientSecret: Redacted.make("s"),
          slug: "domainkit",
          installOrigin: 123,
        } as unknown as NonNullable<Vercel.Options["integration"]>,
      }),
  },
  {
    field: "integration.clientSecret",
    definition: (fetch) =>
      Vercel.provider({
        fetch,
        integration: {
          clientId: "c",
          clientSecret: Config.succeed(Redacted.make("")),
          slug: "domainkit",
        },
      }),
  },
  {
    field: "oauth.clientId",
    definition: (fetch) =>
      Cloudflare.provider({ fetch, oauth: { clientId: " ", clientAuth: "none" } }),
  },
  {
    field: "oauth.clientId",
    definition: (fetch) =>
      Cloudflare.provider({
        fetch,
        oauth: { clientId: unavailable as Config.Config<string>, clientAuth: "none" },
      }),
  },
  {
    field: "oauth.clientSecret",
    definition: (fetch) =>
      Cloudflare.provider({ fetch, oauth: { clientId: "c", clientSecret: missingSecret } }),
  },
  {
    field: "oauth.clientSecret",
    definition: (fetch) =>
      Cloudflare.provider({ fetch, oauth: { clientId: "c", clientSecret: Redacted.make("") } }),
  },
  {
    field: "oauth.clientAuth",
    definition: (fetch) =>
      Cloudflare.provider({
        fetch,
        oauth: {
          clientId: "c",
          clientSecret: Redacted.make("secret-canary"),
          clientAuth: "invalid",
        } as unknown as Cloudflare.OAuthOptions,
      }),
  },
  {
    field: "oauth.scopes",
    definition: (fetch) =>
      Cloudflare.provider({
        fetch,
        oauth: { clientId: "c", clientAuth: "none", scopes: ["blank scope"] },
      }),
  },
  {
    field: "oauth.issuer",
    definition: (fetch) =>
      Cloudflare.provider({
        fetch,
        oauth: { clientId: "c", clientAuth: "none", issuer: "https://secret-canary@oauth.example" },
      }),
  },
  {
    field: "oauth.serverOrigin",
    definition: (fetch) =>
      Cloudflare.provider({
        fetch,
        oauth: {
          clientId: "c",
          clientAuth: "none",
          serverOrigin: "https://oauth.example#secret-canary",
        },
      }),
  },
  {
    field: "integration.clientId",
    definition: (fetch) =>
      Vercel.provider({
        fetch,
        integration: { clientId: "", clientSecret: Redacted.make("s"), slug: "domainkit" },
      }),
  },
  {
    field: "integration.clientSecret",
    definition: (fetch) =>
      Vercel.provider({
        fetch,
        integration: { clientId: "c", clientSecret: missingSecret, slug: "domainkit" },
      }),
  },
  {
    field: "integration.clientSecret",
    definition: (fetch) =>
      Vercel.provider({
        fetch,
        integration: { clientId: "c", clientSecret: Redacted.make(""), slug: "domainkit" },
      }),
  },
  {
    field: "integration.slug",
    definition: (fetch) =>
      Vercel.provider({
        fetch,
        integration: { clientId: "c", clientSecret: Redacted.make("s"), slug: "" },
      }),
  },
  {
    field: "integration.installOrigin",
    definition: (fetch) =>
      Vercel.provider({
        fetch,
        integration: {
          clientId: "c",
          clientSecret: Redacted.make("s"),
          slug: "domainkit",
          installOrigin: "secret-canary",
        },
      }),
  },
  {
    field: "baseUrl",
    definition: (fetch) =>
      Vercel.provider({
        fetch,
        baseUrl: "https://api.example?secret-canary",
        integration: { clientId: "c", clientSecret: Redacted.make("s"), slug: "domainkit" },
      }),
  },
];

for (const { field, definition } of malformed) {
  it(`rejects malformed ${field} before any provider call or continuation write`, async () => {
    const recording = recordedFetch([]);
    const web = mounted(definition(recording.fetch));
    try {
      const response = await web.start();
      assert.strictEqual(response.status, 400);
      const body = (await response.json()) as DomainKit.Error;
      assert.strictEqual(body.reason._tag, "InvalidInput");
      if (body.reason._tag === "InvalidInput") assert.strictEqual(body.reason.field, field);
      assert.ok(!JSON.stringify(body).includes("secret-canary"));
      assert.deepStrictEqual(recording.requests, []);
      assert.deepStrictEqual(web.writes, []);
    } finally {
      await web.dispose();
    }
  });
}
