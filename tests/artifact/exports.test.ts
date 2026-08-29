import { assert, describe, it } from "@effect/vitest";

import packageJson from "../../package.json" with { type: "json" };
import * as effectApi from "../../src/effect.ts";
import * as effectCloudflareApi from "../../src/effect-cloudflare.ts";
import * as effectVercelApi from "../../src/effect-vercel.ts";
import * as promiseApi from "../../src/index.ts";
import * as promiseCloudflareApi from "../../src/cloudflare.ts";
import * as promiseVercelApi from "../../src/vercel.ts";
import * as testingApi from "../../src/testing.ts";

describe("public namespaces", () => {
  it("sources VERSION from the package manifest", () => {
    assert.strictEqual(promiseApi.VERSION, packageJson.version);
    assert.strictEqual(effectApi.VERSION, packageJson.version);
  });

  it("exposes cohesive Promise, Effect, and testing namespace surfaces", () => {
    assert.strictEqual(typeof promiseApi.Provisioning.create, "function");
    assert.strictEqual(typeof promiseApi.ZoneDiscovery.discover, "function");
    assert.strictEqual(typeof promiseApi.Connection.start, "function");
    assert.strictEqual(typeof effectApi.Connection.start, "function");
    assert.strictEqual(typeof effectApi.AuthorizationLifecycle.Service, "function");
    assert.strictEqual(typeof effectApi.DnsProvider.Service, "function");
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
    assert.strictEqual(typeof effectApi.Cloudflare.make, "function");
    assert.strictEqual(typeof effectCloudflareApi.make, "function");
    assert.strictEqual(typeof effectCloudflareApi.discovery, "function");
    assert.strictEqual(typeof promiseApi.Cloudflare.make, "function");
    assert.strictEqual(typeof promiseCloudflareApi.make, "function");
    assert.strictEqual(typeof promiseCloudflareApi.discovery, "function");
    assert.strictEqual(typeof effectApi.Vercel.make, "function");
    assert.strictEqual(typeof effectVercelApi.make, "function");
    assert.strictEqual(typeof effectVercelApi.discovery, "function");
    assert.strictEqual(typeof promiseApi.Vercel.make, "function");
    assert.strictEqual(typeof promiseVercelApi.make, "function");
    assert.strictEqual(typeof promiseVercelApi.discovery, "function");
  });

  it("does not flatten service tags or operations onto either entry point", () => {
    assert.strictEqual("createPlan" in promiseApi, false);
    assert.strictEqual("DnsProviderService" in effectApi, false);
    assert.strictEqual("layerDnsProviderFromPromise" in effectApi, false);
    assert.strictEqual("record" in effectApi.Verification, false);
    assert.strictEqual("record" in promiseApi.Verification, false);
  });
});
