import { assert, describe, it } from "@effect/vitest";

import packageJson from "../../package.json" with { type: "json" };
import { Testing } from "../../src/entry/testing.ts";
import * as root from "../../src/index.ts";

const modules = [
  "Approval",
  "Cleanup",
  "Cloudflare",
  "Connect",
  "Custody",
  "DnsRecord",
  "DomainKit",
  "DomainKitError",
  "DomainName",
  "Plan",
  "Principal",
  "Provider",
  "Providers",
  "Provision",
  "Receipt",
  "Resolver",
  "Storage",
  "Vercel",
  "Verify",
] as const;

describe("public namespaces", () => {
  it("sources VERSION from the package manifest", () => {
    assert.strictEqual(root.VERSION, packageJson.version);
  });

  it("exports exactly the sketched root modules plus VERSION", () => {
    assert.deepStrictEqual(Object.keys(root).sort(), [...modules, "VERSION"].sort());
  });

  it("keeps the entry points to the root and testing until the server layer lands", () => {
    assert.deepStrictEqual(Object.keys(packageJson.exports), [".", "./testing", "./package.json"]);
    assert.strictEqual("./promise" in packageJson.exports, false);
    assert.strictEqual("./server" in packageJson.exports, false);
    assert.strictEqual("./client" in packageJson.exports, false);
  });

  it("names every service tag and value module after its concept", () => {
    assert.strictEqual(typeof root.Provision.Provision, "function");
    assert.strictEqual(typeof root.Provision.plan, "function");
    assert.strictEqual(typeof root.Cleanup.Cleanup, "function");
    assert.strictEqual(typeof root.Connect.Connect, "function");
    assert.strictEqual(typeof root.Connect.Method.token, "function");
    assert.strictEqual(typeof root.Verify.Verify, "function");
    assert.strictEqual(typeof root.Verify.HostEvidence, "function");
    assert.strictEqual(typeof root.Storage.Storage, "function");
    assert.strictEqual(typeof root.Storage.layerFromAsync, "function");
    assert.strictEqual(typeof root.Custody.layerConfig, "function");
    assert.strictEqual(typeof root.Principal.Principal, "function");
    assert.strictEqual(typeof root.Provider.make, "function");
    assert.strictEqual(typeof root.Providers.layer, "function");
    assert.strictEqual(typeof root.Cloudflare.provider, "function");
    assert.strictEqual(typeof root.Vercel.provider, "function");
    assert.strictEqual(typeof root.Resolver.layerWith, "function");
    assert.strictEqual(typeof root.DomainKit.layer, "function");
    assert.strictEqual(typeof root.DomainKit.layerMemory, "function");
    assert.strictEqual(typeof root.DnsRecord.cname, "function");
    assert.strictEqual(typeof root.DomainName.fromStringUnsafe, "function");
    assert.strictEqual(typeof root.Plan.decode, "function");
    assert.strictEqual(typeof root.Receipt.encode, "function");
    assert.strictEqual(typeof root.DomainKitError.DomainKitError, "function");
    assert.strictEqual(typeof Testing.provider, "function");
    assert.strictEqual(typeof Testing.resolver, "function");
    assert.strictEqual(typeof Testing.conformance.storage, "function");
    assert.strictEqual(typeof Testing.conformance.provider, "function");
  });

  it("does not leak internals or old names", () => {
    assert.strictEqual("Provisioning" in root, false);
    assert.strictEqual("Deletion" in root, false);
    assert.strictEqual("Digest" in root, false);
    assert.strictEqual("Secret" in root, false);
    assert.strictEqual("InvalidInput" in root, false);
    assert.strictEqual("Transport" in root, false);
    assert.strictEqual("webCryptoLayer" in root.DomainKit, false);
    assert.strictEqual("InMemoryDnsProvider" in Testing, false);
  });
});
