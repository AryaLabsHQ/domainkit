import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Logger, Schema, Tracer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { DomainKit, Reason } from "../../src/index.ts";
import { Server } from "../../src/entry/server.ts";
import { Testing } from "../../src/entry/testing.ts";

const host = "https://app.test";
const unavailable = new DomainKit.Error({
  reason: new Reason.ProviderUnavailable({ provider: "fake", message: "secret-provider-message" }),
});

const fixture = (failure?: DomainKit.Error, unauthenticated = false) => {
  const fake = Testing.provider({ oauth: true, zones: ["example.com"] });
  const oauth = fake.auth.oauth;
  if (oauth === undefined) throw new Error("OAuth fixture missing");
  const provider: Testing.FakeProvider = {
    ...fake,
    auth: {
      ...fake.auth,
      oauth: {
        ...oauth,
        complete: (input) => (failure === undefined ? oauth.complete(input) : Effect.fail(failure)),
      },
    },
  };
  const logs: Array<ReturnType<typeof Logger.formatStructured.log>> = [];
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const services = Layer.mergeAll(
    DomainKit.layerMemory({ providers: [provider] }),
    Layer.succeed(Server.Identity)({
      principal: () =>
        unauthenticated
          ? Effect.fail(
              new DomainKit.Error({
                reason: new Reason.Unauthenticated({ message: "secret-session-message" }),
              }),
            )
          : Effect.succeed(Testing.principal),
    }),
  );
  const observability = Layer.mergeAll(
    Logger.layer([
      Logger.make((options) => {
        logs.push(Logger.formatStructured.log(options));
      }),
    ]),
    Layer.succeed(Tracer.Tracer)(tracer),
  );
  const app = HttpApiBuilder.layer(Server.api).pipe(
    Layer.provide(Server.layer(Server.api, { defaultReturnTo: "/settings" })),
    Layer.provide(services),
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(observability),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(app, { disableLogger: true });
  const start = async () => {
    const response = await handler(
      new Request(`${host}/connections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "fake", method: { _tag: "OAuth" } }),
      }),
    );
    assert.strictEqual(response.status, 200);
    const started = await response.json();
    const parsed = Schema.decodeUnknownSync(Server.Started)(started);
    if (parsed._tag !== "Redirect") throw new Error("Expected redirect");
    return new URL(parsed.authorizationUrl);
  };
  return { handler, dispose, logs, spans, start };
};

describe("callback recovery observability", () => {
  for (const kind of ["cancelled", "restart", "inspect"] as const) {
    it(`records ${kind} with finite metadata and no raw callback data`, async () => {
      const f = fixture(kind === "inspect" ? unavailable : undefined);
      try {
        const callback = await f.start();
        const state = callback.searchParams.get("state");
        if (kind !== "inspect") {
          callback.searchParams.set(
            "error",
            kind === "cancelled" ? "access_denied" : "secret-error",
          );
        }
        callback.searchParams.set("error_description", "secret-provider-description");
        const response = await f.handler(new Request(callback));
        assert.strictEqual(response.status, 302);
        const expected = {
          "domainkit.callback.outcome": kind === "cancelled" ? "Cancelled" : "Failed",
          "domainkit.callback.provider": "fake",
          "domainkit.callback.reason":
            kind === "inspect" ? "ProviderUnavailable" : "Unauthenticated",
          ...(kind === "cancelled" ? {} : { "domainkit.callback.recovery": kind }),
        };
        assert.strictEqual(f.logs.length, 1);
        assert.strictEqual(f.logs[0]?.level, kind === "cancelled" ? "INFO" : "WARN");
        assert.deepStrictEqual(f.logs[0]?.annotations, expected);
        assert.strictEqual(f.logs[0]?.cause, undefined);
        const recorded = f.spans
          .map((span) =>
            Object.fromEntries(
              [...span.attributes].filter(([key]) => key.startsWith("domainkit.callback.")),
            ),
          )
          .filter((attributes) => Object.keys(attributes).length > 0);
        assert.deepStrictEqual(recorded, [expected]);
        const text = JSON.stringify(f.logs);
        for (const secret of [
          state,
          "fake-code",
          "secret-error",
          "secret-provider-message",
          "secret-provider-description",
        ]) {
          if (secret !== null) assert.isFalse(text.includes(secret));
        }
      } finally {
        await f.dispose();
      }
    });
  }

  it("emits no recovery event for success, a spent flow, or an unknown flow", async () => {
    const f = fixture();
    try {
      const callback = await f.start();
      assert.strictEqual((await f.handler(new Request(callback))).status, 302);
      assert.strictEqual((await f.handler(new Request(callback))).status, 400);
      assert.strictEqual(
        (await f.handler(new Request(`${host}/callback/fake?state=unknown&error=access_denied`)))
          .status,
        400,
      );
      assert.deepStrictEqual(f.logs, []);
    } finally {
      await f.dispose();
    }
  });

  it("emits no recovery event for a host authentication failure", async () => {
    const f = fixture(undefined, true);
    try {
      const response = await f.handler(
        new Request(`${host}/callback/fake?state=unknown&error=access_denied`),
      );
      assert.strictEqual(response.status, 401);
      assert.deepStrictEqual(f.logs, []);
    } finally {
      await f.dispose();
    }
  });
});
