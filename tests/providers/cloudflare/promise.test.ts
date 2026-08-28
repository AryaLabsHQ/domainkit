import { assert, describe, it } from "@effect/vitest";

import { Secret } from "../../../src/index.ts";
import * as Cloudflare from "../../../src/promise/cloudflare.ts";
import { page, portableZone, recordedFetch, zone } from "./fixtures.ts";

describe("Cloudflare Promise facade", () => {
  it("runs the Effect-native client through Promises", async () => {
    const recording = recordedFetch([{ body: page([zone]) }]);
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities: ["dns:read", "dns:write"],
      fetch: recording.fetch,
      token: Secret.make("token"),
    });
    assert.deepStrictEqual(await client.listZones(), [portableZone]);
  });
});
