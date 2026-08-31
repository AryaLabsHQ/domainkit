import { assert, describe, it } from "@effect/vitest";

import packageJson from "../../package.json" with { type: "json" };
import * as effectApi from "../../src/index.ts";
import * as promiseApi from "../../src/promise.ts";
import * as testingApi from "../../src/testing.ts";

describe("public namespaces", () => {
  it("sources VERSION from the package manifest", () => {
    assert.strictEqual(promiseApi.VERSION, packageJson.version);
    assert.strictEqual(effectApi.VERSION, packageJson.version);
  });

  it("keeps Effect native at the root without compatibility subpaths", () => {
    assert.strictEqual("./effect" in packageJson.exports, false);
    assert.strictEqual("./cloudflare" in packageJson.exports, false);
    assert.strictEqual("./vercel" in packageJson.exports, false);
    assert.strictEqual("./effect/cloudflare" in packageJson.exports, false);
    assert.strictEqual("./effect/vercel" in packageJson.exports, false);
    assert.strictEqual("./adapter" in packageJson.exports, false);
    assert.strictEqual("./effect/adapter" in packageJson.exports, false);
  });

  it("exposes cohesive Effect, Promise, and testing namespace surfaces", () => {
    assert.strictEqual(typeof promiseApi.Provisioning.create, "function");
    assert.strictEqual(typeof promiseApi.ZoneDiscovery.discover, "function");
    assert.strictEqual(typeof promiseApi.Connection.start, "function");
    assert.strictEqual(typeof promiseApi.Connection.attach, "function");
    assert.strictEqual(typeof promiseApi.Connection.detach, "function");
    assert.strictEqual(typeof promiseApi.Connection.disconnect, "function");
    assert.strictEqual(typeof effectApi.Connection.start, "function");
    assert.strictEqual(typeof effectApi.Connection.attach, "function");
    assert.strictEqual(typeof effectApi.Connection.detach, "function");
    assert.strictEqual(typeof effectApi.Connection.disconnect, "function");
    assert.strictEqual(typeof effectApi.ManagedDnsConnections.Service, "function");
    assert.strictEqual(typeof effectApi.DnsProvider.Service, "function");
    assert.strictEqual(typeof effectApi.Transport.Service, "function");
    assert.strictEqual(typeof effectApi.Transport.Method.OAuth, "function");
    assert.strictEqual(typeof effectApi.ZoneDiscovery.Service, "function");
    assert.strictEqual(typeof effectApi.Provisioning.create, "function");
    assert.strictEqual(typeof effectApi.CloudflareDnsOverHttps.layer, "function");
    assert.strictEqual(typeof effectApi.GoogleDnsOverHttps.layer, "function");
    assert.strictEqual(typeof effectApi.DnsResolverPool.defaultMake, "function");
    assert.strictEqual(typeof effectApi.Verification.observe, "function");
    assert.strictEqual(typeof effectApi.DnsOverHttps.make, "function");
    assert.strictEqual(typeof promiseApi.DnsOverHttps.make, "function");
    assert.strictEqual(typeof promiseApi.GoogleDnsOverHttps.make, "function");
    assert.strictEqual(typeof promiseApi.DnsResolverPool.defaultMake, "function");
    assert.strictEqual(typeof promiseApi.Verification.observe, "function");
    assert.strictEqual(typeof testingApi.InMemoryDnsProvider.layer, "function");
    assert.strictEqual(typeof testingApi.ProviderConformance.run, "function");
    assert.strictEqual(typeof testingApi.ProviderConformance.fromAsync, "function");
    assert.strictEqual(typeof effectApi.Cloudflare.make, "function");
    assert.strictEqual(typeof promiseApi.Cloudflare.make, "function");
    assert.strictEqual(typeof effectApi.Vercel.make, "function");
    assert.strictEqual(typeof promiseApi.Vercel.make, "function");
  });

  it("does not flatten service tags or operations onto either entry point", () => {
    assert.strictEqual("createPlan" in promiseApi, false);
    assert.strictEqual("AuthorizationLifecycle" in effectApi, false);
    assert.strictEqual("ProviderAuthorization" in effectApi, false);
    assert.strictEqual("Grant" in effectApi.Connection, false);
    assert.strictEqual("extend" in effectApi.Connection, false);
    assert.strictEqual("removeDomain" in effectApi.Connection, false);
    assert.strictEqual("DnsProviderService" in effectApi, false);
    assert.strictEqual("layerDnsProviderFromPromise" in effectApi, false);
    assert.strictEqual("InMemoryConnectionStore" in testingApi, false);
    assert.strictEqual("InMemoryCredentialStore" in testingApi, false);
    assert.strictEqual("record" in effectApi.Verification, false);
    assert.strictEqual("record" in promiseApi.Verification, false);
  });
});
