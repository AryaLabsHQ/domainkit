import { describe, it } from "@effect/vitest";
import { Redacted } from "effect";

import { Vercel } from "../../../src/index.ts";
import { Testing } from "../../../src/entry/testing.ts";
import { conformanceFetch } from "./fixtures.ts";

describe("Vercel provider conformance", () => {
  it.effect("passes the shared offline provider-author contract", () =>
    Testing.conformance.provider(
      Vercel.provider({ fetch: conformanceFetch() }),
      { secret: Redacted.make("token"), context: { teamId: "team-1" } },
      "example.com",
    ),
  );
});
