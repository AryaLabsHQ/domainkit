// User-owned live run: bun tests/live/cloudflare.ts
// Env: DOMAINKIT_LIVE_CLOUDFLARE_TOKEN, DOMAINKIT_LIVE_ZONE, DOMAINKIT_LIVE_ALLOW_ZONE
import { Effect, Redacted, Schema as S } from "effect";

import { Cloudflare } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";
import * as LiveConfig from "./config.ts";

const program = Effect.gen(function* () {
  const config = yield* LiveConfig.decode(S.Struct(LiveConfig.Fields))({
    ...LiveConfig.input(process.env),
    token: process.env.DOMAINKIT_LIVE_CLOUDFLARE_TOKEN,
  });
  const definition = Cloudflare.provider();
  const issued = yield* (definition.auth.token ?? bail()).authenticate({
    token: Redacted.make(config.token),
  });
  yield* Testing.conformance.provider(definition, issued, config.zone);
  console.log(`cloudflare conformance passed for ${config.zone}`);
});

function bail(): never {
  throw new Error("Cloudflare offers no token method");
}

await Effect.runPromise(program);
