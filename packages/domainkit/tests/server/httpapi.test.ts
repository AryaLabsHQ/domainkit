import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpApi, OpenApi } from "effect/unstable/httpapi";

import { DnsRecord, DomainKit, Plan, Reason } from "../../src/index.ts";
import { Server } from "../../src/entry/server.ts";
import { Testing } from "../../src/entry/testing.ts";

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];

const identity = Layer.succeed(Server.Identity)({
  principal: () => Effect.succeed(Testing.principal),
});

const host = "http://domainkit.test";

const server = (options: Server.WebHandlerOptions = {}) => {
  const fake = Testing.provider({ zones: ["example.com"], oauth: true });
  const services = DomainKit.layerMemory({
    providers: [fake],
    resolver: Testing.resolver(),
  }).pipe(Layer.merge(identity));
  const { handler, dispose } = Server.toWebHandler(services, options);
  const prefix = options.prefix ?? "";
  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ readonly status: number; readonly body: unknown }> => {
    const response = await handler(
      new Request(`${host}${prefix}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
        redirect: "manual",
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
  };
  return { fake, call, dispose, handler };
};

const connected = async (call: ReturnType<typeof server>["call"], provider: string) => {
  const started = await call("POST", "/connections", {
    domain: "app.example.com",
    provider,
    method: { _tag: "Token", values: { token: "token" } },
  });
  assert.strictEqual(started.status, 200);
  return started.body as { readonly _tag: string; readonly snapshot: Server.Snapshot };
};

describe("Server.group over the lifecycle", () => {
  it("connects an account without a domain and lists the zones it reaches", async () => {
    const { fake, call, dispose } = server();
    try {
      const started = await call("POST", "/connections", {
        provider: fake.id,
        method: { _tag: "Token", values: { token: "token" } },
      });
      assert.strictEqual(started.status, 200);
      const connection = started.body as Server.Connected;
      assert.strictEqual(connection._tag, "Connected");
      assert.strictEqual(connection.provider, fake.id);
      assert.strictEqual(connection.label, fake.name);
      assert.strictEqual(connection.snapshot, null);

      const listed = await call("GET", "/zones");
      assert.strictEqual(listed.status, 200);
      const zones = listed.body as Server.Zones;
      assert.deepStrictEqual(
        zones.zones.map(({ connectionId, provider, zone }) => [connectionId, provider, zone]),
        [[connection.connectionId, fake.id, "example.com"]],
      );
      assert.deepStrictEqual(zones.connections, [
        { connectionId: connection.connectionId, provider: fake.id, status: "connected" },
      ]);

      assert.deepStrictEqual(
        zones.providers.map(({ id }) => id),
        [fake.id],
      );

      const narrowed = await call("GET", "/zones?provider=nobody");
      assert.strictEqual(narrowed.status, 200);
      assert.deepStrictEqual((narrowed.body as Server.Zones).zones, []);
    } finally {
      void dispose();
    }
  });

  it("connects with a token, plans, approves, applies, observes, and detaches", async () => {
    const { fake, call, dispose } = server();
    try {
      const started = await connected(call, fake.id);
      assert.strictEqual(started._tag, "Connected");
      assert.strictEqual(started.snapshot.status, "connected");
      assert.strictEqual(started.snapshot.provider, fake.id);
      assert.strictEqual(started.snapshot.method, "token");
      assert.strictEqual(started.snapshot.connectionDomains, 1);
      const attachmentId = started.snapshot.attachment?.id ?? null;
      assert.isNotNull(attachmentId);

      const inspected = await call("GET", "/domains/app.example.com");
      assert.strictEqual(inspected.status, 200);
      assert.deepStrictEqual(inspected.body, started.snapshot);

      const planned = await call("POST", "/domains/app.example.com/plans", {
        requirements: requirements.map((record) => JSON.parse(JSON.stringify(record))),
      });
      assert.strictEqual(planned.status, 200);
      const plan = planned.body as {
        readonly id: string;
        readonly operations: ReadonlyArray<{ readonly _tag: string }>;
      };
      assert.deepStrictEqual(
        plan.operations.map(({ _tag }) => _tag),
        ["Create", "Create"],
      );

      const approved = await call("POST", `/plans/${plan.id}/approvals`, {});
      assert.strictEqual(approved.status, 200);
      const approval = approved.body as { readonly id: string; readonly planId: string };
      assert.strictEqual(approval.planId, plan.id);

      const applied = await call("POST", `/approvals/${approval.id}/apply`);
      assert.strictEqual(applied.status, 200);
      const receipt = applied.body as { readonly id: string; readonly status: string };
      assert.strictEqual(receipt.status, "complete");

      const attempt = await call("GET", `/plans/${plan.id}`);
      assert.strictEqual(attempt.status, 200);
      const state = attempt.body as { readonly receipt: { readonly id: string } | null };
      assert.strictEqual(state.receipt?.id, receipt.id);

      const fetched = await call("GET", `/receipts/${receipt.id}`);
      assert.strictEqual(fetched.status, 200);
      assert.deepStrictEqual(fetched.body, applied.body);

      const observed = await call("POST", "/domains/app.example.com/observations", {});
      assert.strictEqual(observed.status, 200);
      const readiness = observed.body as {
        readonly overall: string;
        readonly requirements: ReadonlyArray<unknown>;
      };
      assert.strictEqual(readiness.overall, "ready");
      assert.strictEqual(readiness.requirements.length, 2);

      const unattached = await call("POST", "/domains/nobody.example.com/observations", {
        requirements: [
          {
            _tag: "TXT",
            name: "_acme.nobody.example.com",
            ttl: null,
            policy: "append",
            value: "acme-verify=1",
          },
        ],
      });
      assert.strictEqual(unattached.status, 200);
      const standalone = unattached.body as {
        readonly attachmentId: string | null;
        readonly requirements: ReadonlyArray<{
          readonly evidence: ReadonlyArray<{ readonly _tag: string }>;
        }>;
      };
      assert.strictEqual(standalone.attachmentId, null);
      assert.deepStrictEqual(
        standalone.requirements.map(({ evidence }) => evidence.map(({ _tag }) => _tag)),
        [["PublicDns"]],
      );
      const bare = await call("POST", "/domains/nobody.example.com/observations", {});
      assert.strictEqual(bare.status, 400);

      const cleanupPlan = await call("POST", `/receipts/${receipt.id}/cleanup-plans`);
      assert.strictEqual(cleanupPlan.status, 200);
      const cleanup = cleanupPlan.body as { readonly id: string; readonly kind: string };
      assert.strictEqual(cleanup.kind, "cleanup");

      const cleanupApproval = await call("POST", `/plans/${cleanup.id}/approvals`, {});
      assert.strictEqual(cleanupApproval.status, 200);
      const cleanupApplied = await call(
        "POST",
        `/approvals/${(cleanupApproval.body as { readonly id: string }).id}/apply`,
      );
      assert.strictEqual(cleanupApplied.status, 200);
      assert.strictEqual((cleanupApplied.body as { readonly kind: string }).kind, "cleanup");

      const detached = await call("DELETE", `/attachments/${attachmentId}`);
      assert.strictEqual(detached.status, 200);

      const after = await call("GET", "/domains/app.example.com");
      assert.strictEqual((after.body as Server.Snapshot).status, "disconnected");
    } finally {
      await dispose();
    }
  });

  it("discovers which connection already reaches a domain", async () => {
    const { fake, call, dispose } = server();
    try {
      const before = await call("GET", "/domains/app.example.com/discovery");
      assert.strictEqual(before.status, 200);
      const notFound = before.body as { readonly _tag: string; readonly host: unknown };
      assert.strictEqual(notFound._tag, "NotFound");
      assert.strictEqual(notFound.host, null);

      await connected(call, fake.id);

      const after = await call("GET", "/domains/app.example.com/discovery");
      assert.strictEqual(after.status, 200);
      const resolved = after.body as {
        readonly _tag: string;
        readonly connectionId: string;
        readonly zone: string;
        readonly label: string;
      };
      assert.strictEqual(resolved._tag, "Resolved");
      assert.strictEqual(resolved.zone, "example.com");
      assert.strictEqual(resolved.label, "example.com");
      assert.notStrictEqual(resolved.connectionId, "");
      assert.strictEqual("target" in resolved, false);
    } finally {
      await dispose();
    }
  });

  it("names the provider hosting an unconnected domain's zone", async () => {
    const hosting = Testing.provider({
      id: "hosting",
      zones: ["hosted.test"],
      nameservers: { "hosted.test": ["a.ns.hosting.test", "b.ns.hosting.test"] },
      nameserverSuffixes: ["ns.hosting.test"],
    });
    const { handler, dispose } = Server.toWebHandler(
      DomainKit.layerMemory({ providers: [hosting], resolver: Testing.resolver() }).pipe(
        Layer.merge(identity),
      ),
    );
    try {
      const response = await handler(new Request(`${host}/domains/app.hosted.test/discovery`));
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        _tag: "NotFound",
        nameservers: ["a.ns.hosting.test", "b.ns.hosting.test"],
        host: { provider: "hosting" },
      });
    } finally {
      await dispose();
    }
  });

  it("renders the provider's token fields in the snapshot", async () => {
    const { fake, call, dispose } = server();
    try {
      const inspected = await call("GET", "/domains/app.example.com");
      const snapshot = inspected.body as Server.Snapshot;
      const provider = snapshot.providers.find(({ id }) => id === fake.id);
      assert.isDefined(provider);
      assert.deepStrictEqual(
        provider?.methods.map(({ kind }) => kind),
        ["oauth", "token"],
      );
      assert.strictEqual(snapshot.connectionDomains, 0);
      const token = provider?.methods.find(({ kind }) => kind === "token");
      assert.deepStrictEqual(token?.fields, [{ name: "token", required: true, secret: true }]);
      assert.strictEqual(provider?.methods.find(({ kind }) => kind === "oauth")?.fields, null);
    } finally {
      await dispose();
    }
  });

  it("records a rejection as a terminal attempt state", async () => {
    const { fake, call, dispose } = server();
    try {
      await connected(call, fake.id);
      const planned = await call("POST", "/domains/app.example.com/plans", {
        requirements: requirements.map((record) => JSON.parse(JSON.stringify(record))),
      });
      const plan = planned.body as { readonly id: string };

      const rejected = await call("POST", `/plans/${plan.id}/rejections`, {
        reason: "wrong subdomain",
      });
      assert.strictEqual(rejected.status, 200);
      const attempt = rejected.body as {
        readonly status: string;
        readonly rejection: { readonly actorId: string; readonly reason: string | null } | null;
      };
      assert.strictEqual(attempt.status, "rejected");
      assert.strictEqual(attempt.rejection?.actorId, "user_test");
      assert.strictEqual(attempt.rejection?.reason, "wrong subdomain");

      const read = await call("GET", `/plans/${plan.id}`);
      assert.deepStrictEqual(read.body, rejected.body);

      const late = await call("POST", `/plans/${plan.id}/approvals`, {});
      assert.strictEqual(late.status, 409);
      assert.strictEqual(
        (late.body as { readonly reason: { readonly _tag: string } }).reason._tag,
        "Stale",
      );
    } finally {
      await dispose();
    }
  });

  it("answers with the DomainKitError wire body and its httpStatus", async () => {
    const { call, dispose } = server();
    try {
      const missing = await call("POST", "/domains/nope.example.com/plans", { requirements: [] });
      assert.strictEqual(missing.status, 404);
      assert.deepStrictEqual(missing.body, {
        _tag: "DomainKitError",
        reason: { _tag: "NotFound", entity: "attachment", id: "nope.example.com" },
      });

      const badToken = await call("POST", "/connections", {
        domain: "app.example.com",
        provider: "fake",
        method: { _tag: "Token", values: { token: "" } },
      });
      assert.strictEqual(badToken.status, 401);
      assert.strictEqual(
        (badToken.body as { readonly reason: { readonly _tag: string } }).reason._tag,
        "Unauthenticated",
      );

      const unknownProvider = await call("POST", "/connections", {
        domain: "app.example.com",
        provider: "nope",
        method: { _tag: "Token", values: { token: "token" } },
      });
      assert.strictEqual(unknownProvider.status, 404);
    } finally {
      await dispose();
    }
  });

  it("answers 409 with the conflicting operations when a plan cannot be approved", async () => {
    const fake = Testing.provider({
      zones: ["example.com"],
      records: [
        {
          zone: "example.com",
          record: DnsRecord.cname({ name: "app.example.com", target: "other.acme.dev" }),
        },
      ],
    });
    const services = DomainKit.layerMemory({
      providers: [fake],
      resolver: Testing.resolver(),
    }).pipe(Layer.merge(identity));
    const { handler, dispose } = Server.toWebHandler(services);
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await handler(
        new Request(`${host}${path}`, {
          method,
          ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
        }),
      );
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
    };
    try {
      await call("POST", "/connections", {
        domain: "app.example.com",
        provider: fake.id,
        method: { _tag: "Token", values: { token: "token" } },
      });
      const planned = await call("POST", "/domains/app.example.com/plans", {
        requirements: [JSON.parse(JSON.stringify(requirements[0]))],
      });
      const plan = planned.body as { readonly id: string };
      const approved = await call("POST", `/plans/${plan.id}/approvals`, {});
      assert.strictEqual(approved.status, 409);
      assert.strictEqual(
        (approved.body as { readonly reason: { readonly _tag: string } }).reason._tag,
        "Conflict",
      );
    } finally {
      await dispose();
    }
  });

  it("completes an OAuth connection through the callback and redirects", async () => {
    const { fake, call, handler, dispose } = server({ defaultReturnTo: "/dashboard" });
    try {
      const started = await call("POST", "/connections", {
        domain: "app.example.com",
        provider: fake.id,
        method: { _tag: "OAuth", returnTo: "/settings/domains" },
      });
      assert.strictEqual(started.status, 200);
      const redirect = started.body as { readonly _tag: string; readonly authorizationUrl: string };
      assert.strictEqual(redirect._tag, "Redirect");
      const authorizationUrl = new URL(redirect.authorizationUrl);
      assert.strictEqual(authorizationUrl.origin, host);
      assert.strictEqual(authorizationUrl.pathname, `/callback/${fake.id}`);

      const callback = await handler(new Request(authorizationUrl, { redirect: "manual" }));
      assert.strictEqual(callback.status, 302);
      assert.strictEqual(callback.headers.get("location"), `${host}/settings/domains`);

      const inspected = await call("GET", "/domains/app.example.com");
      assert.strictEqual((inspected.body as Server.Snapshot).status, "connected");
      assert.strictEqual((inspected.body as Server.Snapshot).method, "oauth");
    } finally {
      await dispose();
    }
  });

  it("completes the callback under an identity the browser can satisfy", async () => {
    // The provider drives a top-level navigation to /callback/:provider, so only a credential the
    // browser attaches by itself reaches it. A cookie identity has to work end to end.
    const fake = Testing.provider({ zones: ["example.com"], oauth: true });
    const cookieIdentity = Layer.succeed(Server.Identity)({
      principal: (request) =>
        request.cookies.session === "s3cret"
          ? Effect.succeed(Testing.principal)
          : Effect.fail(
              new DomainKit.Error({
                reason: new Reason.Unauthenticated({ message: "No session" }),
              }),
            ),
    });
    const { handler, dispose } = Server.toWebHandler(
      DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() }).pipe(
        Layer.merge(cookieIdentity),
      ),
      { defaultReturnTo: "/dashboard" },
    );
    const cookie = { cookie: "session=s3cret" };
    try {
      const started = await handler(
        new Request(`${host}/connections`, {
          method: "POST",
          headers: { ...cookie, "content-type": "application/json" },
          body: JSON.stringify({
            domain: "app.example.com",
            provider: fake.id,
            method: { _tag: "OAuth", returnTo: "/settings/domains" },
          }),
        }),
      );
      assert.strictEqual(started.status, 200);
      const { authorizationUrl } = (await started.json()) as { readonly authorizationUrl: string };

      // The provider's redirect carries the cookie but no Authorization header.
      const callback = await handler(
        new Request(authorizationUrl, { headers: cookie, redirect: "manual" }),
      );
      assert.strictEqual(callback.status, 302);
      assert.strictEqual(callback.headers.get("location"), `${host}/settings/domains`);

      const anonymous = await handler(new Request(`${host}/domains/app.example.com`));
      assert.strictEqual(anonymous.status, 401);
    } finally {
      await dispose();
    }
  });

  it("resolves the callback against callbackBaseUrl behind a Host-rewriting proxy", async () => {
    // The browser reaches samva.dev; the edge forwards to api.samva.dev with a rewritten Host, so
    // the request origin is one the customer never sees. `callbackBaseUrl` names the public one.
    const fake = Testing.provider({ zones: ["example.com"], oauth: true });
    const { handler, dispose } = Server.toWebHandler(
      DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() }).pipe(
        Layer.merge(identity),
      ),
      { callbackBaseUrl: "https://public.test/api/domainkit", defaultReturnTo: "/dashboard" },
    );
    try {
      const started = await handler(
        new Request("https://internal.test/connections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            domain: "app.example.com",
            provider: fake.id,
            method: { _tag: "OAuth", returnTo: "/settings/domains" },
          }),
        }),
      );
      assert.strictEqual(started.status, 200);
      const { authorizationUrl } = (await started.json()) as { readonly authorizationUrl: string };
      assert.strictEqual(
        new URL(authorizationUrl).origin + new URL(authorizationUrl).pathname,
        `https://public.test/api/domainkit/callback/${fake.id}`,
      );

      // The provider redirects to the public URL; the edge forwards it to the internal origin.
      const forwarded = new URL(authorizationUrl);
      const internal = new URL(`https://internal.test/callback/${fake.id}${forwarded.search}`);
      const callback = await handler(new Request(internal, { redirect: "manual" }));
      assert.strictEqual(callback.status, 302);
      assert.strictEqual(callback.headers.get("location"), "https://public.test/settings/domains");
    } finally {
      await dispose();
    }
  });

  it("authorizes every route by name, so reads and writes can differ", async () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    const writes = new Set<Server.EndpointName>(["approve", "apply"]);
    const memberIdentity = Layer.succeed(Server.Identity)({
      principal: (request) =>
        Effect.succeed({
          ...Testing.principal,
          actorId: request.headers["x-role"] === "admin" ? "admin" : "member",
        }),
      authorize: (principal, endpoint) =>
        principal.actorId === "admin" || !writes.has(endpoint)
          ? Effect.void
          : Effect.fail(
              new DomainKit.Error({
                reason: new Reason.Forbidden({ message: `${endpoint} needs an administrator` }),
              }),
            ),
    });
    const { handler, dispose } = Server.toWebHandler(
      DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() }).pipe(
        Layer.merge(memberIdentity),
      ),
    );
    const call = async (method: string, path: string, role?: string, body?: unknown) => {
      const response = await handler(
        new Request(`${host}${path}`, {
          method,
          headers: {
            ...(role === undefined ? {} : { "x-role": role }),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
    };
    try {
      await call("POST", "/connections", "admin", {
        domain: "app.example.com",
        provider: fake.id,
        method: { _tag: "Token", values: { token: "token" } },
      });
      const planned = await call("POST", "/domains/app.example.com/plans", "admin", {
        requirements: requirements.map((record) => JSON.parse(JSON.stringify(record))),
      });
      const plan = planned.body as { readonly id: string };

      // A member cannot approve.
      const refused = await call("POST", `/plans/${plan.id}/approvals`, undefined, {});
      assert.strictEqual(refused.status, 403);
      const reason = (
        refused.body as { readonly reason: { readonly _tag: string; readonly message: string } }
      ).reason;
      assert.strictEqual(reason._tag, "Forbidden");
      assert.strictEqual(reason.message, "approve needs an administrator");

      // An administrator can, and apply is gated the same way.
      const approved = await call("POST", `/plans/${plan.id}/approvals`, "admin", {});
      assert.strictEqual(approved.status, 200);
      const approval = approved.body as { readonly id: string };
      assert.strictEqual((await call("POST", `/approvals/${approval.id}/apply`)).status, 403);
      assert.strictEqual(
        (await call("POST", `/approvals/${approval.id}/apply`, "admin")).status,
        200,
      );

      // A member still reads the result.
      assert.strictEqual((await call("GET", "/domains/app.example.com")).status, 200);
      assert.strictEqual(
        (await call("POST", "/domains/app.example.com/observations", undefined, {})).status,
        200,
      );
    } finally {
      await dispose();
    }
  });

  it("refuses a callback whose flow points off this origin", async () => {
    const { fake, call, handler, dispose } = server({ defaultReturnTo: "/dashboard" });
    try {
      const started = await call("POST", "/connections", {
        domain: "app.example.com",
        provider: fake.id,
        method: { _tag: "OAuth", returnTo: "https://evil.example/steal" },
      });
      const { authorizationUrl } = started.body as { readonly authorizationUrl: string };

      const callback = await handler(new Request(authorizationUrl, { redirect: "manual" }));
      assert.strictEqual(callback.status, 400);
      assert.strictEqual(callback.headers.get("location"), null);
      const refused = JSON.parse(await callback.text()) as {
        readonly reason: { readonly _tag: string; readonly field?: string };
      };
      assert.strictEqual(refused.reason._tag, "InvalidInput");
      assert.strictEqual(refused.reason.field, "returnTo");

      // The continuation is still unspent, so the flow can be finished from a safe destination.
      const inspected = await call("GET", "/domains/app.example.com");
      assert.strictEqual((inspected.body as Server.Snapshot).status, "disconnected");
    } finally {
      await dispose();
    }
  });

  it.each(["//evil.example", "/\\evil.example", "https://evil.example/steal", "\\/evil.example"])(
    "refuses %s as a callback destination",
    async (returnTo) => {
      const { fake, call, handler, dispose } = server({ defaultReturnTo: "/dashboard" });
      try {
        const started = await call("POST", "/connections", {
          domain: "app.example.com",
          provider: fake.id,
          method: { _tag: "OAuth", returnTo },
        });
        const { authorizationUrl } = started.body as { readonly authorizationUrl: string };
        const callback = await handler(new Request(authorizationUrl, { redirect: "manual" }));
        assert.strictEqual(callback.status, 400);
        assert.strictEqual(callback.headers.get("location"), null);
        const refused = JSON.parse(await callback.text()) as {
          readonly reason: { readonly field?: string };
        };
        assert.strictEqual(refused.reason.field, "returnTo");
      } finally {
        await dispose();
      }
    },
  );

  it("falls back to defaultReturnTo when the flow named no destination", async () => {
    const { fake, call, handler, dispose } = server({ defaultReturnTo: "/dashboard" });
    try {
      const started = await call("POST", "/connections", {
        domain: "app.example.com",
        provider: fake.id,
        method: { _tag: "OAuth" },
      });
      const { authorizationUrl } = started.body as { readonly authorizationUrl: string };
      const callback = await handler(new Request(authorizationUrl, { redirect: "manual" }));
      assert.strictEqual(callback.status, 302);
      assert.strictEqual(callback.headers.get("location"), `${host}/dashboard`);
    } finally {
      await dispose();
    }
  });

  it("ignores a returnTo the provider adds to the callback query", async () => {
    const { fake, call, handler, dispose } = server({ defaultReturnTo: "/dashboard" });
    try {
      const started = await call("POST", "/connections", {
        domain: "app.example.com",
        provider: fake.id,
        method: { _tag: "OAuth", returnTo: "/settings/domains" },
      });
      const { authorizationUrl } = started.body as { readonly authorizationUrl: string };
      const tampered = new URL(authorizationUrl);
      tampered.searchParams.set("returnTo", "https://evil.example/steal");

      const callback = await handler(new Request(tampered, { redirect: "manual" }));
      assert.strictEqual(callback.status, 302);
      assert.strictEqual(callback.headers.get("location"), `${host}/settings/domains`);
    } finally {
      await dispose();
    }
  });

  it("resolves every route under any mount prefix", async () => {
    const { fake, call, dispose } = server({ prefix: "/internal/dns" });
    try {
      const started = await connected(call, fake.id);
      assert.strictEqual(started._tag, "Connected");

      const inspected = await call("GET", "/domains/app.example.com");
      assert.strictEqual(inspected.status, 200);

      const planned = await call("POST", "/domains/app.example.com/plans", {
        requirements: requirements.map((record) => JSON.parse(JSON.stringify(record))),
      });
      assert.strictEqual(planned.status, 200);
    } finally {
      await dispose();
    }
  });

  it("derives the callback URL from the mount prefix", async () => {
    const { fake, call, dispose } = server({ prefix: "/internal/dns" });
    try {
      const started = await call("POST", "/connections", {
        domain: "app.example.com",
        provider: fake.id,
        method: { _tag: "OAuth" },
      });
      const redirect = started.body as { readonly authorizationUrl: string };
      assert.strictEqual(
        new URL(redirect.authorizationUrl).pathname,
        `/internal/dns/callback/${fake.id}`,
      );
    } finally {
      await dispose();
    }
  });
});

describe("Server.api", () => {
  it("generates an OpenAPI document covering every route", () => {
    const spec = OpenApi.fromApi(Server.api);
    const operations = Object.values(spec.paths).flatMap((item) => Object.values(item));
    assert.strictEqual(operations.length, 16);
    assert.deepStrictEqual(
      operations
        .map((operation) => (operation as { readonly operationId: string }).operationId)
        .sort(),
      [
        "domainkit.apply",
        "domainkit.approve",
        "domainkit.attach",
        "domainkit.callback",
        "domainkit.cleanupPlan",
        "domainkit.createPlan",
        "domainkit.detach",
        "domainkit.disconnect",
        "domainkit.discover",
        "domainkit.inspect",
        "domainkit.observe",
        "domainkit.plan",
        "domainkit.receipt",
        "domainkit.reject",
        "domainkit.start",
        "domainkit.zones",
      ],
    );
    const observe = spec.paths["/domains/{domain}/observations"]?.post as
      | { readonly requestBody?: { readonly content: Record<string, unknown> } }
      | undefined;
    assert.isDefined(observe?.requestBody?.content["application/json"]);
    const notFound = spec.components?.schemas?.["_domainkit_server_Discovery_NotFoundEncoded"] as
      | { readonly properties?: Record<string, unknown>; readonly required?: ReadonlyArray<string> }
      | undefined;
    assert.isDefined(notFound?.properties?.host);
    assert.include(notFound?.required ?? [], "host");
  });

  it("declares a response for every status a DomainKitError reason produces", () => {
    const spec = OpenApi.fromApi(Server.api);
    const inspect = spec.paths["/domains/{domain}"]?.get;
    assert.isDefined(inspect);
    const declared = Object.keys(inspect?.responses ?? {})
      .map(Number)
      .filter((status) => status >= 400);

    const reasons: ReadonlyArray<Reason.Model> = [
      new Reason.InvalidInput({ message: "bad" }),
      new Reason.Unauthenticated({ message: "no" }),
      new Reason.Forbidden({ message: "no" }),
      new Reason.NotFound({ entity: "plan", id: "plan_1" }),
      new Reason.Conflict({ planId: Plan.PlanId.make("plan_1"), operations: [] }),
      new Reason.Stale({
        planId: Plan.PlanId.make("plan_1"),
        digest: Plan.Digest.make("digest"),
      }),
      new Reason.Expired({ entity: "plan", id: "plan_1" }),
      new Reason.Busy({ key: "apply" }),
      new Reason.ProviderRejected({ provider: "fake", message: "no" }),
      new Reason.ProviderConflict({ provider: "fake", message: "taken" }),
      new Reason.Unsupported({ provider: "fake", operation: "dns:write", message: "no" }),
      new Reason.ProviderUnavailable({ provider: "fake", message: "later" }),
      new Reason.Reconnect({ provider: "fake", connectionId: "conn_1" }),
      new Reason.StorageFailed({ operation: "put", message: "no" }),
      new Reason.CryptoFailed({ operation: "seal" }),
      new Reason.ResolverFailed({ resolver: "fake", message: "no" }),
    ];
    const unserved = reasons
      .map((reason) => new DomainKit.Error({ reason }))
      .filter((error) => !declared.includes(error.httpStatus))
      .map((error) => `${error.reason._tag} -> ${error.httpStatus}`);
    assert.deepStrictEqual(unserved, []);
  });

  it("mounts under a prefix without rebuilding the group", () => {
    const prefixed = HttpApi.make("app").add(Server.group.prefix("/internal/dns"));
    const spec = OpenApi.fromApi(prefixed);
    assert.ok(Object.keys(spec.paths).every((path) => path.startsWith("/internal/dns/")));
  });
});
