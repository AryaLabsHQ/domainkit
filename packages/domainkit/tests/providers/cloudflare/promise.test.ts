import { assert, describe, it } from "@effect/vitest";

import { DomainName, Secret } from "../../../src/promise.ts";
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

  it("discovers OAuth account context through the Effect-native implementation", async () => {
    const recording = recordedFetch([{ body: page([zone]) }]);
    const resolve = Cloudflare.Auth.subjectResolver({
      capabilities: ["dns:read"],
      domain: DomainName.parse("example.com"),
      fetch: recording.fetch,
    });
    const subject = await resolve(
      { access_token: "oauth-token", token_type: "bearer" },
      Secret.make("oauth-token"),
    );
    assert.strictEqual(subject.accountId, "account-1");
  });

  it("mirrors credential-scoped target discovery and target-bound writes", async () => {
    const recording = recordedFetch([{ body: page([zone]) }]);
    const client = Cloudflare.make({
      capabilities: ["dns:read", "dns:write"],
      fetch: recording.fetch,
      token: Secret.make("token"),
    });
    const targets = await client.listTargets();
    assert.strictEqual(targets[0]?.zoneId, "zone-1");
    assert.strictEqual(targets[0]?.accountId, "account-1");
  });
});
