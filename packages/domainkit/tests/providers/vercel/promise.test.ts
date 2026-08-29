import { assert, describe, it } from "@effect/vitest";

import { Secret } from "../../../src/index.ts";
import * as Vercel from "../../../src/promise/vercel.ts";
import { domain, domainPage, portableZone, recordedFetch } from "./fixtures.ts";

describe("Vercel Promise facade", () => {
  it("runs the Effect-native client and integration exchange", async () => {
    const zones = recordedFetch([{ body: domainPage([domain]) }]);
    const client = Vercel.make({
      capabilities: ["dns:read"],
      context: { _tag: "team", teamId: "team-1" },
      fetch: zones.fetch,
      token: Secret.make("token"),
    });
    assert.deepStrictEqual(await client.listZones(), [portableZone]);

    const exchange = recordedFetch([
      { body: { access_token: "access-token", team_id: null, user_id: "user-1" } },
    ]);
    const credential = await Vercel.Auth.exchangeCode({
      clientId: "client-1",
      clientSecret: Secret.make("secret"),
      code: Secret.make("code"),
      fetch: exchange.fetch,
      redirectUri: "https://app.example/callback",
    });
    assert.deepStrictEqual(credential.context, { _tag: "personal" });
  });
});
