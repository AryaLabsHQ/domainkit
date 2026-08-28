import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as Digest from "../../src/plan/canonical-json.ts";
import * as LiveRunner from "./runner.ts";

describe("live provider approval", () => {
  it.effect("binds the approval digest to the provider subject", () =>
    Effect.gen(function* () {
      const first = yield* LiveRunner.makeApproval("plan-digest", {
        providerId: "vercel",
        subjectId: "team-one",
        subjectType: "team",
      });
      const second = yield* LiveRunner.makeApproval("plan-digest", {
        providerId: "vercel",
        subjectId: "team-two",
        subjectType: "team",
      });
      assert.notStrictEqual(first.digest, second.digest);
    }).pipe(Effect.provide(Digest.webCryptoLayer)),
  );
});
