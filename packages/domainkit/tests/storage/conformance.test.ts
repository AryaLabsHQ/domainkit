import { describe, it } from "@effect/vitest";

import { Storage } from "../../src/index.ts";
import { storage } from "../../src/internal/conformance/storage.ts";

describe("Storage.layerMemory conformance", () => {
  storage(Storage.layerMemory, { it });
});
