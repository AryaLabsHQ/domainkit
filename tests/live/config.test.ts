import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema as S } from "effect";

import * as LiveConfig from "./config.ts";

const Schema = S.Struct({ ...LiveConfig.Fields, token: S.String });

const valid = {
  allowedRecordName: "_domainkit-live.example.com",
  allowedZone: "example.com",
  approvedDigest: null,
  command: "preview",
  recordName: "_domainkit-live.example.com",
  recordValue: "domainkit-live",
  token: "secret",
  zone: "example.com",
};

describe("live provider configuration", () => {
  it.effect("decodes an explicitly allowlisted preview", () =>
    Effect.gen(function* () {
      const config = yield* LiveConfig.decode(Schema)(valid);
      assert.strictEqual(config.zone, "example.com");
    }),
  );

  it.effect("rejects records outside the configured zone", () =>
    Effect.gen(function* () {
      const failure = yield* LiveConfig.decode(Schema)({
        ...valid,
        allowedRecordName: "_domainkit-live.example.net",
        recordName: "_domainkit-live.example.net",
      }).pipe(Effect.flip);
      assert.strictEqual(failure.message, "The live record must belong to the configured zone");
    }),
  );

  it.effect("requires an exact digest before apply", () =>
    Effect.gen(function* () {
      const failure = yield* LiveConfig.decode(Schema)({
        ...valid,
        approvedDigest: null,
        command: "apply",
      }).pipe(Effect.flip);
      assert.strictEqual(failure.message, "DOMAINKIT_LIVE_APPROVED_DIGEST is required for apply");
    }),
  );
});
