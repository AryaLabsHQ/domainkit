import { describe, it } from "@effect/vitest";
import { Redacted } from "effect";

import { Cloudflare } from "../../../src/index.ts";
import { Testing } from "../../../src/entry/testing.ts";
import { conformanceFetch } from "./fixtures.ts";

describe("Cloudflare provider conformance", () => {
  it.effect("passes the shared offline provider-author contract", () =>
    Testing.conformance.provider(
      Cloudflare.provider({ fetch: conformanceFetch() }),
      { secret: Redacted.make("token"), context: { accountId: "account-1" } },
      "example.com",
    ),
  );
});
