import { Effect, Schema as S } from "effect";

import * as Secret from "../../src/auth/secret.ts";
import * as Cloudflare from "../../src/providers/cloudflare/index.ts";
import * as LiveConfig from "./config.ts";
import * as LiveRunner from "./runner.ts";

const Schema = S.Struct({
  ...LiveConfig.Fields,
  accountId: S.String.check(S.isMinLength(1)),
  token: S.String.check(S.isMinLength(1)),
});

const program = Effect.gen(function* () {
  const config = yield* LiveConfig.decode(Schema)({
    ...LiveConfig.input(process.argv[2], process.env),
    accountId: process.env.DOMAINKIT_LIVE_CLOUDFLARE_ACCOUNT_ID,
    token: process.env.DOMAINKIT_LIVE_CLOUDFLARE_TOKEN,
  });
  const provider = Cloudflare.make({
    accountId: config.accountId,
    capabilities: ["dns:read", "dns:write"],
    token: Secret.make(config.token),
  });
  yield* LiveRunner.run({ config, provider, validateCredential: provider.validateToken() });
});

await Effect.runPromise(program);
