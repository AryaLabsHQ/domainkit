import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpApi, OpenApi } from "effect/unstable/httpapi";

import { DnsRecord, DomainKit, DomainKitError, Plan } from "../../src/index.ts";
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
    method: { _tag: "Token", token: "token" },
  });
  assert.strictEqual(started.status, 200);
  return started.body as { readonly _tag: string; readonly snapshot: Server.Snapshot };
};

describe("Server.group over the lifecycle", () => {
  it("connects with a token, plans, approves, applies, observes, and detaches", async () => {
    const { fake, call, dispose } = server();
    try {
      const started = await connected(call, fake.id);
      assert.strictEqual(started._tag, "Connected");
      assert.strictEqual(started.snapshot.status, "connected");
      assert.strictEqual(started.snapshot.provider, fake.id);
      assert.strictEqual(started.snapshot.method, "token");
      const attachmentId = started.snapshot.attachmentId;
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

      const observed = await call("POST", "/domains/app.example.com/observations");
      assert.strictEqual(observed.status, 200);
      const readiness = observed.body as {
        readonly overall: string;
        readonly requirements: ReadonlyArray<unknown>;
      };
      assert.strictEqual(readiness.overall, "ready");
      assert.strictEqual(readiness.requirements.length, 2);

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
        method: { _tag: "Token", token: "" },
      });
      assert.strictEqual(badToken.status, 401);
      assert.strictEqual(
        (badToken.body as { readonly reason: { readonly _tag: string } }).reason._tag,
        "Unauthenticated",
      );

      const unknownProvider = await call("POST", "/connections", {
        domain: "app.example.com",
        provider: "nope",
        method: { _tag: "Token", token: "token" },
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
        method: { _tag: "Token", token: "token" },
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
      assert.strictEqual(callback.headers.get("location"), "/dashboard");

      const inspected = await call("GET", "/domains/app.example.com");
      assert.strictEqual((inspected.body as Server.Snapshot).status, "connected");
      assert.strictEqual((inspected.body as Server.Snapshot).method, "oauth");
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
    assert.strictEqual(operations.length, 13);
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
        "domainkit.inspect",
        "domainkit.observe",
        "domainkit.plan",
        "domainkit.receipt",
        "domainkit.start",
      ],
    );
  });

  it("declares a response for every status a DomainKitError reason produces", () => {
    const spec = OpenApi.fromApi(Server.api);
    const inspect = spec.paths["/domains/{domain}"]?.get;
    assert.isDefined(inspect);
    const declared = Object.keys(inspect?.responses ?? {})
      .map(Number)
      .filter((status) => status >= 400);

    const reasons: ReadonlyArray<DomainKitError.Reason> = [
      new DomainKitError.InvalidInput({ message: "bad" }),
      new DomainKitError.Unauthenticated({ message: "no" }),
      new DomainKitError.Forbidden({ message: "no" }),
      new DomainKitError.NotFound({ entity: "plan", id: "plan_1" }),
      new DomainKitError.Conflict({ planId: Plan.PlanId.make("plan_1"), operations: [] }),
      new DomainKitError.Stale({
        planId: Plan.PlanId.make("plan_1"),
        digest: Plan.Digest.make("digest"),
      }),
      new DomainKitError.Expired({ entity: "plan", id: "plan_1" }),
      new DomainKitError.Busy({ key: "apply" }),
      new DomainKitError.ProviderRejected({ provider: "fake", message: "no" }),
      new DomainKitError.ProviderUnavailable({ provider: "fake", message: "later" }),
      new DomainKitError.Reconnect({ provider: "fake", connectionId: "conn_1" }),
      new DomainKitError.StorageFailed({ operation: "put", message: "no" }),
      new DomainKitError.CryptoFailed({ operation: "seal" }),
      new DomainKitError.ResolverFailed({ resolver: "fake", message: "no" }),
    ];
    const unserved = reasons
      .map((reason) => new DomainKitError.DomainKitError({ reason }))
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
