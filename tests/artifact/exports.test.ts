import { describe, expect, it } from "vitest";

import packageJson from "../../package.json" with { type: "json" };
import { VERSION } from "../../src/index.ts";

describe("public artifact", () => {
  it("exposes the package manifest version", () => {
    expect(VERSION).toBe(packageJson.version);
  });
});
