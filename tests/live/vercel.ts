import { Effect, Schema as S } from "effect";

import * as Secret from "../../src/auth/secret.ts";
import * as Vercel from "../../src/providers/vercel/index.ts";
import * as LiveConfig from "./config.ts";
import * as LiveRunner from "./runner.ts";

const Schema = S.Struct({
  ...LiveConfig.Fields,
  teamId: S.String.check(S.isMinLength(1)),
  token: S.String.check(S.isMinLength(1)),
});

const program = Effect.gen(function* () {
  const config = yield* LiveConfig.decode(Schema)({
    ...LiveConfig.input(process.argv[2], process.env),
    teamId: process.env.DOMAINKIT_LIVE_VERCEL_TEAM_ID,
    token: process.env.DOMAINKIT_LIVE_VERCEL_TOKEN,
  });
  const provider = Vercel.make({
    capabilities: ["dns:read", "dns:write"],
    context: { _tag: "team", teamId: config.teamId },
    token: Secret.make(config.token),
  });
  yield* LiveRunner.run({
    config,
    provider,
    providerScope: {
      providerId: provider.id,
      subjectId: config.teamId,
      subjectType: "team",
    },
    validateCredential: provider.validateToken(),
  });
});

await Effect.runPromise(program);
