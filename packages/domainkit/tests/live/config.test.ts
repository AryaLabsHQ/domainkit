import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema as S } from "effect";

import * as LiveConfig from "./config.ts";

const schema = S.Struct(LiveConfig.Fields);

describe("live config", () => {
  it.effect("requires the allow-listed zone to match the target zone", () =>
    Effect.gen(function* () {
      const ok = yield* LiveConfig.decode(schema)({
        allowedZone: "Example.com",
        token: "t",
        zone: "example.com",
      });
      assert.strictEqual(ok.zone, "example.com");
      const mismatch = yield* LiveConfig.decode(schema)({
        allowedZone: "other.com",
        token: "t",
        zone: "example.com",
      }).pipe(Effect.flip);
      assert.strictEqual(mismatch.reason._tag, "InvalidInput");
      const missing = yield* LiveConfig.decode(schema)({ zone: "example.com" }).pipe(Effect.flip);
      assert.strictEqual(missing.reason._tag, "InvalidInput");
    }),
  );
});
