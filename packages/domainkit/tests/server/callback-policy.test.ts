import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { Custody, DomainKit, Principal, Reason, Storage } from "../../src/index.ts";
import { Server } from "../../src/entry/server.ts";
import { Testing } from "../../src/entry/testing.ts";

const host = "https://app.test";
const outage = new DomainKit.Error({
  reason: new Reason.ProviderUnavailable({ provider: "fake", message: "secret-outage" }),
});

const fixture = (options: Server.WebHandlerOptions = {}, selection = false) => {
  const fake = Testing.provider({ oauth: true, zones: ["example.com"] });
  const oauth = fake.auth.oauth;
  if (oauth === undefined) throw new Error("OAuth fixture missing");
  let exchanges = 0;
  let current: Principal.Interface = Testing.principal;
  let hostFailure: DomainKit.Error | undefined;
  let authorizeFailure: DomainKit.Error | undefined;
  let held: Storage.Interface | undefined;
  let exchangeFailure: DomainKit.Error | undefined;
  let connectionFailure = false;
  let attachmentFailure = false;
  const written: Array<Storage.Authorization> = [];
  let entered: () => void = () => {};
  const exchanging = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let gate: Promise<void> | undefined;
  let race: "identity-consume" | "identity-expire" | "lock-consume" | "lock-expire" | undefined;
  const seen: Array<Server.CallbackOutcome> = [];
  const scoped = <A, E>(effect: Effect.Effect<A, E, Principal.Service>) =>
    effect.pipe(Effect.provideService(Principal.Service, Testing.principal));
  const stored = () => {
    if (held === undefined) throw new Error("Storage not acquired");
    return held;
  };
  const invalidate = (storage: Storage.Interface, id: string, expire: boolean) =>
    scoped(
      Effect.gen(function* () {
        if (expire) {
          const flow = yield* storage.continuations.get(id);
          yield* storage.continuations.put(
            new Storage.Continuation({ ...flow, expiresAt: DateTime.makeUnsafe(0) }),
          );
        } else yield* storage.continuations.consume(id);
      }),
    );
  const backing = Storage.layerMemory;
  const storage = Layer.effect(Storage.Service)(
    Effect.map(Storage.Service, (base): Storage.Interface => {
      held = base;
      return {
        ...base,
        continuations: {
          ...base.continuations,
          get: (id) =>
            base.continuations.get(id).pipe(
              Effect.flatMap((flow) => {
                if (race === "lock-consume" || race === "lock-expire") {
                  const expire = race === "lock-expire";
                  race = undefined;
                  return invalidate(base, id, expire).pipe(Effect.as(flow));
                }
                return Effect.succeed(flow);
              }),
            ),
        },
        authorizations: {
          ...base.authorizations,
          upsert: (input) =>
            base.authorizations.upsert(input).pipe(
              Effect.tap((authorization) =>
                Effect.sync(() => {
                  written.push(authorization);
                }),
              ),
            ),
        },
        connections: {
          ...base.connections,
          create: (id) => (connectionFailure ? Effect.fail(outage) : base.connections.create(id)),
        },
        attachments: {
          ...base.attachments,
          create: (input) =>
            attachmentFailure ? Effect.fail(outage) : base.attachments.create(input),
        },
      };
    }),
  ).pipe(Layer.provide(backing));
  const provider: Testing.FakeProvider = {
    ...fake,
    session: (credential) => {
      const session = fake.session(credential);
      return {
        ...session,
        resolveTarget: (domain) =>
          selection
            ? session
                .listTargets()
                .pipe(
                  Effect.map((candidates) => ({ _tag: "SelectionRequired" as const, candidates })),
                )
            : session.resolveTarget(domain),
      };
    },
    auth: {
      ...fake.auth,
      oauth: {
        ...oauth,
        complete: (input) =>
          Effect.gen(function* () {
            exchanges++;
            entered();
            if (gate !== undefined) yield* Effect.promise(() => gate ?? Promise.resolve());
            return exchangeFailure === undefined
              ? yield* oauth.complete(input)
              : yield* Effect.fail(exchangeFailure);
          }),
      },
    },
  };
  const base = DomainKit.layer({ providers: [provider], resolver: Testing.resolver() }).pipe(
    Layer.provideMerge(
      Layer.mergeAll(storage, Custody.layer({ key: Redacted.make(Custody.generateKey()) })),
    ),
  );
  const identity = Layer.effect(Server.Identity)(
    Effect.map(Storage.Service, (store): Server.IdentityService => ({
      principal: (_request, context) =>
        Effect.gen(function* () {
          if (hostFailure !== undefined) return yield* Effect.fail(hostFailure);
          if (
            context !== undefined &&
            (race === "identity-consume" || race === "identity-expire")
          ) {
            const expire = race === "identity-expire";
            race = undefined;
            yield* invalidate(store, state(new URL(_request.originalUrl)), expire);
          }
          return current;
        }),
      authorize: () =>
        authorizeFailure === undefined ? Effect.void : Effect.fail(authorizeFailure),
    })),
  ).pipe(Layer.provide(storage));
  const { handler, dispose } = Server.toWebHandler(Layer.merge(base, identity), {
    defaultReturnTo: "/domains",
    ...options,
    ...(options.callback === undefined
      ? {}
      : {
          callback: (outcome: Server.CallbackOutcome) => {
            seen.push(outcome);
            assert.isTrue(Schema.is(Server.CallbackOutcome)(outcome));
            const policy = options.callback;
            if (policy === undefined) throw new Error("Expected policy");
            return policy(outcome);
          },
        }),
  });
  const call = (path: string, body?: unknown) =>
    handler(
      new Request(`${host}${options.prefix ?? ""}${path}`, {
        ...(body === undefined
          ? {}
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      }),
    );
  const start = async (
    method: "OAuth" | "Token" = "OAuth",
    extra: { returnTo?: string; domain?: string } = {},
  ) => {
    const response = await call("/connections", {
      provider: fake.id,
      ...(extra.domain === undefined ? {} : { domain: extra.domain }),
      method:
        method === "OAuth"
          ? { _tag: "OAuth", ...(extra.returnTo === undefined ? {} : { returnTo: extra.returnTo }) }
          : { _tag: "Token", values: { token: "token" } },
    });
    assert.strictEqual(response.status, 200);
    return Schema.decodeUnknownSync(Server.Started)(await response.json());
  };
  const redirect = async (extra: { returnTo?: string; domain?: string } = {}) => {
    const value = await start("OAuth", extra);
    if (value._tag !== "Redirect") throw new Error("Expected redirect");
    return new URL(value.authorizationUrl);
  };
  return {
    fake,
    seen,
    call,
    start,
    redirect,
    handler,
    dispose,
    exchanges: () => exchanges,
    refuseHost: (error: DomainKit.Error, authorize = false) => {
      if (authorize) authorizeFailure = error;
      else hostFailure = error;
    },
    as: (value: Principal.Interface) => {
      current = value;
    },
    race: (value: typeof race) => {
      race = value;
    },
    failExchange: (value?: DomainKit.Error) => {
      exchangeFailure = value;
    },
    failConnection: () => {
      connectionFailure = true;
    },
    failAttachment: () => {
      attachmentFailure = true;
    },
    gate: (value: Promise<void>) => {
      gate = value;
    },
    expire: (id: string) => Effect.runPromise(invalidate(stored(), id, true)),
    consume: (id: string) => Effect.runPromise(scoped(stored().continuations.consume(id))),
    flow: (id: string) => Effect.runPromise(scoped(stored().continuations.get(id))),
    connections: () => Effect.runPromise(scoped(stored().connections.list())),
    authorizations: () =>
      Effect.runPromise(
        scoped(
          Effect.forEach(written, (authorization) => stored().authorizations.get(authorization.id)),
        ),
      ),
    exchanging,
  };
};
const responseValue = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
  headers: Object.fromEntries(response.headers),
});
const state = (url: URL) => {
  const id = url.searchParams.get("state");
  if (id === null) throw new Error("Expected state");
  return id;
};
const refuse = {
  status: 400,
  body: JSON.stringify({
    _tag: "DomainKitError",
    reason: {
      _tag: "InvalidInput",
      message: "This callback does not match a connection you started",
      field: "state",
    },
  }),
  headers: { "content-type": "application/json", "content-length": "140" },
};

describe("mounted callback destination policy", () => {
  for (const callback of [undefined, () => Effect.succeed(undefined)]) {
    it(`preserves default success/error responses with ${callback === undefined ? "absent" : "undefined"} policy`, async () => {
      const f = fixture(callback === undefined ? {} : { callback });
      try {
        const url = await f.redirect({ returnTo: "/settings" });
        const deny = new URL(url);
        deny.searchParams.set("error", "access_denied");
        assert.deepStrictEqual(await responseValue(await f.handler(new Request(deny))), {
          status: 401,
          body: JSON.stringify({
            _tag: "DomainKitError",
            reason: { _tag: "Unauthenticated", message: "Provider returned access_denied" },
          }),
          headers: { "content-type": "application/json", "content-length": "105" },
        });
        assert.strictEqual((await f.flow(state(url))).id, state(url));
        const missing = new URL(url);
        missing.searchParams.delete("code");
        assert.strictEqual((await f.handler(new Request(missing))).status, 401);
        assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), {
          status: 302,
          body: "",
          headers: { location: `${host}/settings` },
        });
      } finally {
        await f.dispose();
      }
    });
  }

  for (const [error, tag] of [
    ["access_denied", "Cancelled"],
    ["user_cancelled", "Failed"],
    ["secret-token<script>", "Failed"],
  ] as const) {
    it(`classifies ${error} only after live verification and retains retries`, async () => {
      const f = fixture({ callback: () => Effect.succeed("/recover") });
      try {
        const url = await f.redirect();
        url.searchParams.set("error", error);
        assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), {
          status: 302,
          body: "",
          headers: { location: `${host}/recover` },
        });
        assert.deepStrictEqual(f.seen, [
          tag === "Failed"
            ? { _tag: "Failed", provider: "fake", returnTo: `${host}/domains`, recovery: "restart" }
            : { _tag: "Cancelled", provider: "fake", returnTo: `${host}/domains` },
        ]);
        assert.strictEqual(f.exchanges(), 0);
        assert.strictEqual((await f.flow(state(url))).id, state(url));
        url.searchParams.delete("error");
        assert.strictEqual((await f.handler(new Request(url))).status, 302);
        assert.strictEqual(f.exchanges(), 1);
        assert.strictEqual(f.seen[1]?._tag, "Connected");
      } finally {
        await f.dispose();
      }
    });
  }

  it("handles missing code but refuses missing state before policy/exchange", async () => {
    const f = fixture({ callback: () => Effect.succeed("/recover") });
    try {
      const url = await f.redirect();
      url.searchParams.delete("code");
      assert.strictEqual((await f.handler(new Request(url))).status, 302);
      assert.deepStrictEqual(f.seen, [
        { _tag: "Failed", provider: "fake", returnTo: `${host}/domains`, recovery: "restart" },
      ]);
      url.searchParams.delete("state");
      assert.strictEqual((await f.handler(new Request(url))).status, 400);
      assert.strictEqual(f.seen.length, 1);
      assert.strictEqual(f.exchanges(), 0);
    } finally {
      await f.dispose();
    }
  });

  for (const destination of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "\\/evil.test",
    "\\\\evil.test",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "ftp://app.test/finished",
    "file:///finished",
  ]) {
    it(`refuses unsafe policy destination ${destination}`, async () => {
      const f = fixture({ callback: () => Effect.succeed(destination) });
      try {
        const url = await f.redirect();
        url.searchParams.set("error", "access_denied");
        const response = await f.handler(new Request(url));
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.headers.get("location"), null);
        assert.strictEqual(f.exchanges(), 0);
        assert.strictEqual((await f.flow(state(url))).id, state(url));
      } finally {
        await f.dispose();
      }
    });
  }

  for (const publicOrigin of [host, "https://public.test"]) {
    for (const source of ["policy", "returnTo", "defaultReturnTo"] as const) {
      for (const denied of [false, true]) {
        it(`refuses matching-origin blob ${source} at ${publicOrigin}, denial=${denied}`, async () => {
          const destination = `blob:${publicOrigin}/id`;
          const f = fixture({
            prefix: "/api/dns",
            callbackBaseUrl: `${publicOrigin}/api/dns`,
            ...(source === "defaultReturnTo" ? { defaultReturnTo: destination } : {}),
            callback: () => Effect.succeed(source === "policy" ? destination : "/recover"),
          });
          try {
            const url = await f.redirect(source === "returnTo" ? { returnTo: destination } : {});
            url.host = "app.test";
            if (denied) url.searchParams.set("error", "access_denied");
            const response = await f.handler(new Request(url));
            assert.strictEqual(response.status, 400);
            assert.strictEqual(response.headers.get("location"), null);
            const error = await response.json();
            assert.strictEqual(error._tag, "DomainKitError");
            assert.strictEqual(error.reason._tag, "InvalidInput");
            assert.strictEqual(error.reason.field, source === "policy" ? "callback" : "returnTo");
            assert.strictEqual(f.seen.length, source === "policy" ? 1 : 0);
            assert.strictEqual(f.exchanges(), source === "policy" && !denied ? 1 : 0);
            assert.strictEqual(
              (await f.connections()).length,
              source === "policy" && !denied ? 1 : 0,
            );
            if (source !== "policy" || denied)
              assert.strictEqual((await f.flow(state(url))).id, state(url));
          } finally {
            await f.dispose();
          }
        });
      }
    }
  }

  for (const publicOrigin of ["http://public.test", "https://public.test"]) {
    for (const destination of ["/finished", `${publicOrigin}/one/../finished`]) {
      for (const source of ["policy", "returnTo"] as const) {
        it(`allows same-origin HTTP(S) ${source} destination ${destination}`, async () => {
          const f = fixture({
            prefix: "/api/dns",
            callbackBaseUrl: `${publicOrigin}/api/dns`,
            callback: () => Effect.succeed(source === "policy" ? destination : undefined),
          });
          try {
            const url = await f.redirect(source === "returnTo" ? { returnTo: destination } : {});
            url.protocol = "https:";
            url.host = "app.test";
            const response = await f.handler(new Request(url));
            assert.strictEqual(response.status, 302);
            assert.strictEqual(response.headers.get("location"), `${publicOrigin}/finished`);
            assert.strictEqual(f.seen.length, 1);
            assert.strictEqual(f.exchanges(), 1);
          } finally {
            await f.dispose();
          }
        });
      }
    }
  }

  for (const destination of [
    "//app.test/finished",
    "/safe\\path",
    "https://app.test/one/../finished",
  ]) {
    it(`normalizes safe policy destination ${destination}`, async () => {
      const f = fixture({ callback: () => Effect.succeed(destination) });
      try {
        const url = await f.redirect();
        const response = await f.handler(new Request(url));
        assert.strictEqual(response.status, 302);
        assert.strictEqual(
          response.headers.get("location"),
          destination === "/safe\\path" ? `${host}/safe/path` : `${host}/finished`,
        );
      } finally {
        await f.dispose();
      }
    });
  }

  it("retains exact default provider-error and outage replies, without changing retry behavior", async () => {
    const f = fixture();
    try {
      const url = await f.redirect();
      url.searchParams.set("error", "arbitrary");
      assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), {
        status: 401,
        body: '{"_tag":"DomainKitError","reason":{"_tag":"Unauthenticated","message":"Provider returned arbitrary"}}',
        headers: { "content-type": "application/json", "content-length": "101" },
      });
      url.searchParams.delete("error");
      f.failExchange(outage);
      assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), {
        status: 503,
        body: '{"_tag":"DomainKitError","reason":{"_tag":"ProviderUnavailable","provider":"fake","message":"secret-outage"}}',
        headers: { "content-type": "application/json", "content-length": "109" },
      });
      assert.strictEqual(f.exchanges(), 1);
      assert.strictEqual((await f.flow(state(url))).id, state(url));
    } finally {
      await f.dispose();
    }
  });

  it("validates saved returnTo before policy/exchange, even for denial", async () => {
    const f = fixture({ callback: () => Effect.succeed("/recover") });
    try {
      const url = await f.redirect({ returnTo: "/\\evil.test" });
      url.searchParams.set("error", "access_denied");
      assert.strictEqual((await f.handler(new Request(url))).status, 400);
      assert.strictEqual(f.seen.length, 0);
      assert.strictEqual(f.exchanges(), 0);
      assert.strictEqual((await f.flow(state(url))).id, state(url));
    } finally {
      await f.dispose();
    }
  });

  it("normalizes same-origin paths against the proxy public base and mount", async () => {
    const f = fixture({
      prefix: "/api/dns",
      callbackBaseUrl: "https://public.test/api/dns",
      callback: (outcome) => {
        assert.strictEqual(outcome.returnTo, "https://public.test/domains");
        return Effect.succeed("../finish");
      },
    });
    try {
      const url = await f.redirect();
      url.host = "app.test";
      assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), {
        status: 302,
        body: "",
        headers: { location: "https://public.test/api/dns/finish" },
      });
      assert.strictEqual(f.seen[0]?._tag, "Connected");
    } finally {
      await f.dispose();
    }
  });

  it("offers inspect for grant outage without spending, and allows a later retry", async () => {
    const f = fixture({ callback: () => Effect.succeed("/recover") });
    try {
      const url = await f.redirect();
      f.failExchange(outage);
      assert.strictEqual((await f.handler(new Request(url))).status, 302);
      assert.deepStrictEqual(f.seen, [
        { _tag: "Failed", provider: "fake", returnTo: `${host}/domains`, recovery: "inspect" },
      ]);
      assert.strictEqual((await f.flow(state(url))).id, state(url));
      assert.strictEqual((await f.connections()).length, 0);
      f.failExchange();
      assert.strictEqual((await f.handler(new Request(url))).status, 302);
    } finally {
      await f.dispose();
    }
  });

  it("offers restart for a refused grant and inspect for an attachment NotFound after durability", async () => {
    const f = fixture({ callback: () => Effect.succeed("/recover") });
    try {
      const url = await f.redirect({ domain: "unreachable.test" });
      f.failExchange(
        new DomainKit.Error({
          reason: new Reason.Unauthenticated({ message: "reused-code-secret" }),
        }),
      );
      assert.strictEqual((await f.handler(new Request(url))).status, 302);
      assert.deepStrictEqual(f.seen[0], {
        _tag: "Failed",
        provider: "fake",
        returnTo: `${host}/domains`,
        recovery: "restart",
      });
      f.failExchange();
      assert.strictEqual((await f.handler(new Request(url))).status, 302);
      assert.deepStrictEqual(f.seen[1], {
        _tag: "Failed",
        provider: "fake",
        returnTo: `${host}/domains`,
        recovery: "inspect",
      });
      assert.strictEqual((await f.connections()).length, 1);
      assert.strictEqual((await f.flow(state(url))).id, state(url));
    } finally {
      await f.dispose();
    }
  });

  for (const authorize of [false, true]) {
    it(`keeps host ${authorize ? "authorization" : "authentication"} failures out of policy for live and unknown flows`, async () => {
      const f = fixture({ callback: () => Effect.succeed("/recover") });
      try {
        const url = await f.redirect();
        const id = state(url);
        f.refuseHost(
          new DomainKit.Error({
            reason: authorize
              ? new Reason.Forbidden({ message: "No access" })
              : new Reason.Unauthenticated({ message: "No session" }),
          }),
          authorize,
        );
        const live = await responseValue(await f.handler(new Request(url)));
        url.searchParams.set("state", "unknown");
        assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), live);
        assert.strictEqual(live.status, authorize ? 403 : 401);
        assert.strictEqual(f.seen.length, 0);
        assert.strictEqual(f.exchanges(), 0);
        assert.strictEqual((await f.flow(id)).id, id);
      } finally {
        await f.dispose();
      }
    });
  }

  it("reports Connected for durable zone selection and reconnect preserves the connection", async () => {
    const f = fixture({ callback: () => Effect.succeed(undefined) }, true);
    try {
      const url = await f.redirect({ domain: "app.example.com" });
      assert.strictEqual((await f.handler(new Request(url))).status, 302);
      const first = f.seen[0];
      if (first?._tag !== "Connected") throw new Error("Expected Connected");
      const response = await f.call(`/connections/${first.connectionId}/reconnections`, {
        method: { _tag: "OAuth" },
      });
      const again = Schema.decodeUnknownSync(Server.Started)(await response.json());
      if (again._tag !== "Redirect") throw new Error("Expected reconnect redirect");
      assert.strictEqual((await f.handler(new Request(again.authorizationUrl))).status, 302);
      assert.deepStrictEqual(f.seen[1], first);
      assert.strictEqual((await f.connections()).length, 1);
    } finally {
      await f.dispose();
    }
  });

  it("keeps a durable connection when policy fails; replay cannot invoke it again", async () => {
    const f = fixture({ callback: () => Effect.fail(outage) });
    try {
      const url = await f.redirect();
      assert.strictEqual((await f.handler(new Request(url))).status, outage.httpStatus);
      assert.strictEqual((await f.connections()).length, 1);
      assert.strictEqual(f.seen[0]?._tag, "Connected");
      assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), refuse);
      assert.strictEqual(f.seen.length, 1);
      assert.strictEqual(f.exchanges(), 1);
    } finally {
      await f.dispose();
    }
  });

  for (const partial of ["authorization", "connection"] as const) {
    it(`offers inspect after partial ${partial} persistence without claiming rollback`, async () => {
      const f = fixture({ callback: () => Effect.succeed("/inspect") });
      try {
        const url = await f.redirect({ domain: "app.example.com" });
        if (partial === "authorization") f.failConnection();
        else f.failAttachment();
        assert.strictEqual((await f.handler(new Request(url))).status, 302);
        assert.deepStrictEqual(f.seen, [
          { _tag: "Failed", provider: "fake", returnTo: `${host}/domains`, recovery: "inspect" },
        ]);
        assert.strictEqual((await f.authorizations()).length, 1);
        assert.strictEqual((await f.connections()).length, partial === "connection" ? 1 : 0);
        assert.strictEqual((await f.flow(state(url))).id, state(url));
      } finally {
        await f.dispose();
      }
    });
  }

  for (const kind of [
    "unknown",
    "expired",
    "spent",
    "owner",
    "actor",
    "provider",
    "identity-consume",
    "identity-expire",
    "lock-consume",
    "lock-expire",
  ] as const) {
    for (const denial of [false, true]) {
      it(`has the constant refusal for ${kind}${denial ? " with denial" : ""}, zero policy/exchange`, async () => {
        const f = fixture({ callback: () => Effect.succeed("/recover") });
        try {
          const url = await f.redirect();
          const id = state(url);
          if (kind === "unknown") url.searchParams.set("state", "unknown");
          if (kind === "expired") await f.expire(id);
          if (kind === "spent") await f.consume(id);
          if (kind === "owner") f.as({ ...Testing.principal, ownerId: "other" });
          if (kind === "actor") f.as({ ...Testing.principal, actorId: "other" });
          if (kind === "provider") url.pathname = "/callback/other";
          if (
            kind === "identity-consume" ||
            kind === "identity-expire" ||
            kind === "lock-consume" ||
            kind === "lock-expire"
          )
            f.race(kind);
          if (denial) url.searchParams.set("error", "access_denied");
          assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), refuse);
          assert.strictEqual(f.seen.length, 0);
          assert.strictEqual(f.exchanges(), 0);
          if (["owner", "actor", "provider", "unknown"].includes(kind)) {
            assert.strictEqual((await f.flow(id)).id, id);
            f.as(Testing.principal);
            url.searchParams.set("state", id);
            url.pathname = "/callback/fake";
            url.searchParams.delete("error");
            assert.strictEqual((await f.handler(new Request(url))).status, 302);
          }
        } finally {
          await f.dispose();
        }
      });
    }
  }

  it("serializes concurrent completion without duplicate exchange or policy", async () => {
    const f = fixture({ callback: () => Effect.succeed(undefined) });
    let release: () => void = () => {
      throw new Error("Gate not acquired");
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const url = await f.redirect();
      f.gate(gate);
      const first = f.handler(new Request(url));
      // Wait for the provider boundary, not a guessed delay.
      await f.exchanging;
      const second = await f.handler(new Request(url));
      assert.strictEqual(second.status, 409);
      release();
      assert.strictEqual((await first).status, 302);
      assert.strictEqual(f.exchanges(), 1);
      assert.strictEqual(f.seen.length, 1);
      assert.deepStrictEqual(await responseValue(await f.handler(new Request(url))), refuse);
    } finally {
      release();
      await f.dispose();
    }
  });
});
