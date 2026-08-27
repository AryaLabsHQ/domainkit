import { describe, expect, it } from "vitest";

import packageJson from "../../package.json" with { type: "json" };
import * as effectApi from "../../src/effect.ts";
import * as promiseApi from "../../src/index.ts";
import { VERSION } from "../../src/index.ts";

describe("public artifact", () => {
  it("exposes the package manifest version", () => {
    expect(VERSION).toBe(packageJson.version);
  });

  it("keeps Effect capabilities out of the Promise entry point", () => {
    expect("DnsProvider" in promiseApi).toBe(false);
    expect("layerDnsProviderFromPromise" in promiseApi).toBe(false);
    expect("CloudflareDnsResolver" in promiseApi).toBe(false);
    expect(effectApi.DnsProvider).toBeDefined();
    expect(effectApi.layerDnsProviderFromPromise).toBeTypeOf("function");
    expect(effectApi.CloudflareDnsResolver).toBeTypeOf("function");
  });
});
