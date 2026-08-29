import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ProviderContext, Secret } from "../../src/effect.ts";

describe("provider-owned context", () => {
  const Context = Schema.Struct({
    installationId: Schema.NullOr(Schema.String),
    teamId: Schema.String,
  });
  const codec = ProviderContext.codec("vercel.v1", Context);

  it.effect("round-trips versioned JSON-safe context", () =>
    Effect.gen(function* () {
      const envelope = yield* codec.encode({ installationId: "icfg_1", teamId: "team_1" });
      assert.deepStrictEqual(envelope, {
        value: { installationId: "icfg_1", teamId: "team_1" },
        version: "vercel.v1",
      });
      assert.deepStrictEqual(yield* codec.decode(envelope), {
        installationId: "icfg_1",
        teamId: "team_1",
      });
    }),
  );

  it.effect("rejects unknown context versions", () =>
    Effect.gen(function* () {
      const failure = yield* codec
        .decode({ value: { installationId: null, teamId: "team_1" }, version: "vercel.v2" })
        .pipe(Effect.flip);
      assert.strictEqual(failure._tag, "InvalidInputError");
    }),
  );

  it("never serializes secret contents", () => {
    assert.strictEqual(JSON.stringify(Secret.make("never-visible")), '"[REDACTED]"');
  });
});
