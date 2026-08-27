import { describe, expect, it } from "vitest";

import { VERSION } from "../../src/index.ts";

describe("public artifact", () => {
  it("exposes the reserved package version", () => {
    expect(VERSION).toBe("0.0.1");
  });
});
