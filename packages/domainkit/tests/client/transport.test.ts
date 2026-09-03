import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DnsRecord, DomainKit, Plan } from "../../src/index.ts";
import { Transport } from "../../src/entry/client.ts";
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

/** `fromFetch` over the in-process server: the same encoding, routing, and decoding as a browser. */
const inProcess = (
  options: {
    readonly provider?: Testing.FakeProviderOptions;
    readonly capabilities?: ReadonlyArray<Transport.Capability>;
  } = {},
) => {
  const fake = Testing.provider({ zones: ["example.com"], ...options.provider });
  const { handler, dispose } = Server.toWebHandler(
    DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() }).pipe(
      Layer.merge(identity),
    ),
    { prefix: "/api/domainkit" },
  );
  const transport = Transport.fromFetch("http://domainkit.test/api/domainkit/", {
    fetch: (input, init) => handler(new Request(input, init)),
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
  });
  return { fake, transport, dispose };
};

/** Every group is present in these tests; narrow once instead of asserting at each call site. */
const groups = (transport: Transport.Interface) => {
  const { connection, provisioning, verification, cleanup } = transport;
  if (
    connection === undefined ||
    provisioning === undefined ||
    verification === undefined ||
    cleanup === undefined
  ) {
    throw new Error("The transport is missing a capability group");
  }
  return { connection, provisioning, verification, cleanup };
};

describe("Transport.fromFetch", () => {
  it.effect("round-trips connect, plan, approve, apply, observe, and cleanup", () => {
    const { fake, transport, dispose } = inProcess();
    const { connection, provisioning, verification, cleanup } = groups(transport);
    return Effect.gen(function* () {
      const started = yield* connection.start({
        domain: "app.example.com",
        provider: fake.id,
        method: Transport.Method.token("token"),
      });
      assert.strictEqual(started._tag, "Connected");
      if (started._tag !== "Connected") return;
      assert.strictEqual(started.snapshot.status, "connected");
      assert.strictEqual(started.snapshot.provider, fake.id);
      const attachmentId = started.snapshot.attachmentId;
      assert.isNotNull(attachmentId);

      const discovery = yield* connection.discover("app.example.com");
      assert.strictEqual(discovery._tag, "Resolved");
      if (discovery._tag === "Resolved") {
        assert.strictEqual(discovery.zone, "example.com");
        assert.strictEqual(discovery.connectionId, started.snapshot.connectionId);
      }

      const snapshot = yield* connection.inspect("app.example.com");
      assert.deepStrictEqual(snapshot, started.snapshot);
      assert.deepStrictEqual(
        snapshot.providers.map(({ id }) => id),
        [fake.id],
      );

      const plan = yield* provisioning.plan({ domain: "app.example.com", requirements });
      assert.strictEqual(plan.kind, "provisioning");
      assert.deepStrictEqual(
        plan.operations.map(({ _tag }) => _tag),
        ["Create", "Create"],
      );
      assert.strictEqual(Plan.isApplicable(plan), true);

      const approval = yield* provisioning.approve({ planId: plan.id });
      assert.strictEqual(approval.digest, plan.digest);

      const receipt = yield* provisioning.apply(approval.id);
      assert.strictEqual(receipt.status, "complete");

      const attempt = yield* provisioning.attempt(plan.id);
      assert.strictEqual(attempt.status, "complete");
      assert.strictEqual(attempt.receipt?.id, receipt.id);
      assert.strictEqual(attempt.approval?.id, approval.id);
      assert.strictEqual(attempt.rejection, null);

      const readiness = yield* verification.observe("app.example.com");
      assert.strictEqual(readiness.overall, "ready");
      assert.strictEqual(readiness.requirements.length, 2);
      assert.strictEqual(readiness.nextCheckAt, null);

      const cleanupPlan = yield* cleanup.plan(receipt.id);
      assert.strictEqual(cleanupPlan.kind, "cleanup");
      const cleanupApproval = yield* cleanup.approve({ planId: cleanupPlan.id });
      const cleanupReceipt = yield* cleanup.apply(cleanupApproval.id);
      assert.strictEqual(cleanupReceipt.kind, "cleanup");
      assert.strictEqual(cleanupReceipt.status, "complete");

      if (attachmentId === null) return;
      yield* connection.detach(attachmentId);
      const detached = yield* connection.inspect("app.example.com");
      assert.strictEqual(detached.status, "disconnected");
      assert.strictEqual(detached.attachmentId, null);
    }).pipe(Effect.ensuring(Effect.promise(dispose)));
  });

  it.effect("returns a failure as the same tagged DomainKitError", () => {
    const { fake, transport, dispose } = inProcess({
      provider: {
        records: [
          {
            zone: "example.com",
            record: DnsRecord.cname({ name: "app.example.com", target: "other.acme.dev" }),
          },
        ],
      },
    });
    const { connection, provisioning } = groups(transport);
    return Effect.gen(function* () {
      yield* connection.start({
        domain: "app.example.com",
        provider: fake.id,
        method: Transport.Method.token("token"),
      });
      const plan = yield* provisioning.plan({
        domain: "app.example.com",
        requirements: requirements.slice(0, 1),
      });

      const conflict = yield* Effect.flip(provisioning.approve({ planId: plan.id }));
      assert.strictEqual(DomainKit.isError(conflict), true);
      assert.strictEqual(conflict.reason._tag, "Conflict");
      assert.strictEqual(conflict.httpStatus, 409);
      assert.strictEqual(conflict.category, "plan");
      if (conflict.reason._tag !== "Conflict") return;
      assert.strictEqual(conflict.reason.planId, plan.id);
      assert.deepStrictEqual(
        conflict.reason.operations.map(({ reason }) => reason),
        ["cname-collision"],
      );

      const missing = yield* Effect.flip(provisioning.attempt(Plan.PlanId.make("plan_missing")));
      assert.strictEqual(missing.reason._tag, "NotFound");
      assert.strictEqual(missing.httpStatus, 404);
      if (missing.reason._tag !== "NotFound") return;
      assert.strictEqual(missing.reason.entity, "plan");
    }).pipe(Effect.ensuring(Effect.promise(dispose)));
  });

  it.effect("rejects a plan and refuses to approve it afterwards", () => {
    const { fake, transport, dispose } = inProcess();
    const { connection, provisioning } = groups(transport);
    return Effect.gen(function* () {
      yield* connection.start({
        domain: "app.example.com",
        provider: fake.id,
        method: Transport.Method.token("token"),
      });
      const plan = yield* provisioning.plan({ domain: "app.example.com", requirements });

      const rejected = yield* provisioning.reject({ planId: plan.id, reason: "wrong subdomain" });
      assert.strictEqual(rejected.status, "rejected");
      assert.strictEqual(rejected.rejection?.reason, "wrong subdomain");

      const stale = yield* Effect.flip(provisioning.approve({ planId: plan.id }));
      assert.strictEqual(stale.reason._tag, "Stale");
      assert.strictEqual(stale.httpStatus, 409);
      if (stale.reason._tag !== "Stale") return;
      assert.strictEqual(stale.reason.planId, plan.id);
    }).pipe(Effect.ensuring(Effect.promise(dispose)));
  });

  it.effect("reports a server it cannot read as a retryable failure", () =>
    Effect.gen(function* () {
      const transport = Transport.fromFetch("https://domainkit.test/api", {
        fetch: () => Promise.resolve(new Response("<html>502</html>", { status: 502 })),
      });
      const { connection } = groups(transport);
      const error = yield* Effect.flip(connection.inspect("app.example.com"));
      assert.strictEqual(error.reason._tag, "ProviderUnavailable");
      assert.strictEqual(error.isRetryable, true);
      if (error.reason._tag !== "ProviderUnavailable") return;
      assert.strictEqual(error.reason.provider, "https://domainkit.test");
    }),
  );

  it("declares only the capabilities the server exposes", () => {
    const { transport, dispose } = inProcess({ capabilities: ["connection"] });
    try {
      assert.deepStrictEqual(Transport.capabilities(transport), ["connection"]);
      assert.strictEqual(transport.provisioning, undefined);
      assert.strictEqual(transport.verification, undefined);
      assert.strictEqual(transport.cleanup, undefined);

      const { transport: full } = inProcess();
      assert.deepStrictEqual(Transport.capabilities(full), [
        "connection",
        "provisioning",
        "verification",
        "cleanup",
      ]);
    } finally {
      void dispose();
    }
  });

  it("typechecks a transport that carries connection alone", () => {
    const connectionOnly: Transport.Interface = {
      connection: {
        inspect: () => Effect.die("unused"),
        discover: () => Effect.die("unused"),
        start: () => Effect.die("unused"),
        attach: () => Effect.die("unused"),
        detach: () => Effect.die("unused"),
        disconnect: () => Effect.die("unused"),
      },
    };
    assert.deepStrictEqual(Transport.capabilities(connectionOnly), ["connection"]);
  });
});

describe("Transport.fromAsync and Transport.toAsync", () => {
  it("round-trips a transport through Promises, keeping the reason", async () => {
    const { fake, transport, dispose } = inProcess();
    try {
      const asPromises = Transport.toAsync(transport);
      const back = Transport.fromAsync(asPromises);
      const { connection, provisioning } = groups(back);

      const started = await Effect.runPromise(
        connection.start({
          domain: "app.example.com",
          provider: fake.id,
          method: Transport.Method.token("token"),
        }),
      );
      assert.strictEqual(started._tag, "Connected");

      const failure = await Effect.runPromise(
        Effect.flip(provisioning.plan({ domain: "nope.example.com", requirements })),
      );
      assert.strictEqual(failure.reason._tag, "NotFound");
    } finally {
      await dispose();
    }
  });
});

describe("Testing.transport", () => {
  it.effect("drives the lifecycle in memory and records every call", () => {
    const transport = Testing.transport();
    const { connection, provisioning } = groups(transport);
    return Effect.gen(function* () {
      const snapshot = yield* connection.inspect("app.example.com");
      assert.strictEqual(snapshot.status, "disconnected");
      const provider = snapshot.providers[0];
      assert.isDefined(provider);
      if (provider === undefined) return;
      // The form a UI renders comes straight off the descriptor.
      assert.deepStrictEqual(provider.methods.find(({ kind }) => kind === "token")?.fields, [
        { name: "token", required: true, secret: true },
      ]);

      yield* connection.discover("app.example.com");
      yield* connection.start({
        domain: "app.example.com",
        provider: provider.id,
        method: Transport.Method.token({ token: "token" }),
      });
      const plan = yield* provisioning.plan({ domain: "app.example.com", requirements });
      yield* provisioning.apply((yield* provisioning.approve({ planId: plan.id })).id);
      const second = yield* provisioning.plan({ domain: "app.example.com", requirements });
      yield* provisioning.reject({ planId: second.id });

      assert.deepStrictEqual(
        transport.calls.map(({ method }) => method),
        [
          "connection.inspect",
          "connection.discover",
          "connection.start",
          "provisioning.plan",
          "provisioning.approve",
          "provisioning.apply",
          "provisioning.plan",
          "provisioning.reject",
        ],
      );
      assert.deepStrictEqual(transport.calls[0]?.input, "app.example.com");
      assert.deepStrictEqual(transport.calls[4]?.input, { planId: plan.id });
      assert.deepStrictEqual(transport.calls[7]?.input, { planId: second.id });
    });
  });

  it("hides the groups the options leave out", () => {
    const transport = Testing.transport({ capabilities: ["connection", "verification"] });
    assert.deepStrictEqual(Transport.capabilities(transport), ["connection", "verification"]);
    assert.deepStrictEqual(transport.calls, []);
  });
});
