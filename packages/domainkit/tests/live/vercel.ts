// User-owned live run: bun tests/live/vercel.ts
// Env: DOMAINKIT_LIVE_VERCEL_TOKEN, DOMAINKIT_LIVE_VERCEL_TEAM_ID (optional), DOMAINKIT_LIVE_ZONE, DOMAINKIT_LIVE_ALLOW_ZONE
import { Effect, Redacted, Schema as S } from "effect";

import { Vercel } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";
import * as LiveConfig from "./config.ts";

const program = Effect.gen(function* () {
  const config = yield* LiveConfig.decode(S.Struct(LiveConfig.Fields))({
    ...LiveConfig.input(process.env),
    token: process.env.DOMAINKIT_LIVE_VERCEL_TOKEN,
  });
  const definition = Vercel.provider();
  const issued = yield* (definition.auth.token ?? bail()).authenticate(Redacted.make(config.token));
  const credential = {
    ...issued,
    context: { teamId: process.env.DOMAINKIT_LIVE_VERCEL_TEAM_ID ?? null },
  };
  yield* Testing.conformance.provider(definition, credential, config.zone);
  console.log(`vercel conformance passed for ${config.zone}`);
});

function bail(): never {
  throw new Error("Vercel offers no token method");
}

await Effect.runPromise(program);
