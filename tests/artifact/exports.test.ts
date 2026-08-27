import { assert, describe, it } from "@effect/vitest";

import packageJson from "../../package.json" with { type: "json" };
import * as effectApi from "../../src/effect.ts";
import * as promiseApi from "../../src/index.ts";
import * as testingApi from "../../src/testing.ts";

describe("public namespaces", () => {
  it("sources VERSION from the package manifest", () => {
    assert.strictEqual(promiseApi.VERSION, packageJson.version);
    assert.strictEqual(effectApi.VERSION, packageJson.version);
  });

  it("exposes cohesive Promise, Effect, and testing namespace surfaces", () => {
    assert.strictEqual(typeof promiseApi.Provisioning.create, "function");
    assert.strictEqual(typeof promiseApi.OAuth.begin, "function");
    assert.strictEqual(typeof effectApi.DnsProvider.Service, "function");
    assert.strictEqual(typeof effectApi.Provisioning.create, "function");
    assert.strictEqual(typeof effectApi.CloudflareDnsOverHttps.layer, "function");
    assert.strictEqual(typeof effectApi.DnsOverHttps.make, "function");
    assert.strictEqual(typeof promiseApi.DnsOverHttps.make, "function");
    assert.strictEqual(typeof testingApi.InMemoryDnsProvider.layer, "function");
  });

  it("does not flatten service tags or operations onto either entry point", () => {
    assert.strictEqual("createPlan" in promiseApi, false);
    assert.strictEqual("DnsProviderService" in effectApi, false);
    assert.strictEqual("layerDnsProviderFromPromise" in effectApi, false);
  });
});
