import { assert, describe, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { Schema } from "effect";

import packageJson from "../../package.json" with { type: "json" };
import { Transport } from "../../src/entry/client.ts";
import { Server } from "../../src/entry/server.ts";
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
  "DomainName",
  "Plan",
  "Principal",
  "Provider",
  "Providers",
  "Provision",
  "Reason",
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

  it("publishes the four entry points plus one subpath per root namespace", async () => {
    const source = await readFile(new URL("../../src/index.ts", import.meta.url), "utf8");
    const namespaces = [...source.matchAll(/^export \* as (\w+) from "\.\/\1\.ts";$/gm)].map(
      ([, name]) => name,
    );
    assert.deepStrictEqual(namespaces, [...modules]);
    assert.deepStrictEqual(Object.keys(packageJson.exports), [
      ".",
      "./client",
      "./server",
      "./testing",
      ...namespaces.map((name) => `./${name}`),
      "./package.json",
    ]);
    const subpaths: Record<string, unknown> = packageJson.exports;
    for (const name of namespaces) {
      assert.deepStrictEqual(subpaths[`./${name}`], {
        types: `./dist/types/${name}.d.ts`,
        import: `./dist/${name}.mjs`,
      });
    }
    assert.strictEqual("./promise" in packageJson.exports, false);
  });

  it("keeps the client surface to the transport, its adapters, and the capability list", () => {
    assert.deepStrictEqual(Object.keys(Transport).sort(), [
      "Method",
      "allCapabilities",
      "capabilities",
      "fromAsync",
      "fromFetch",
      "toAsync",
    ]);
    assert.deepStrictEqual(Transport.allCapabilities, [
      "connection",
      "provisioning",
      "verification",
      "cleanup",
    ]);
    assert.strictEqual(typeof Testing.transport, "function");
  });

  it("keeps the server surface to the group, its layers, and the wire schemas", () => {
    assert.deepStrictEqual(Object.keys(Server).sort(), [
      "ApprovePayload",
      "AttachPayload",
      "Attempt",
      "Candidate",
      "Connected",
      "ConnectionStatus",
      "Discovery",
      "DiscoveryNotFound",
      "DiscoveryResolved",
      "DiscoverySelectionRequired",
      "Field",
      "Identity",
      "Integration",
      "Method",
      "MethodDescriptor",
      "OAuth",
      "ObservePayload",
      "PlanPayload",
      "Readiness",
      "Redirect",
      "RejectPayload",
      "SelectionRequired",
      "Snapshot",
      "StartPayload",
      "Started",
      "Token",
      "api",
      "group",
      "layer",
      "toWebHandler",
    ]);
  });

  it("names every service tag and value module after its concept", () => {
    assert.strictEqual(typeof root.Provision.Service, "function");
    assert.strictEqual(typeof root.Provision.plan, "function");
    assert.strictEqual(typeof root.Cleanup.Service, "function");
    assert.strictEqual(typeof root.Connect.Service, "function");
    assert.strictEqual(typeof root.Connect.Method.token, "function");
    assert.strictEqual(typeof root.Verify.Service, "function");
    assert.strictEqual(typeof root.Verify.HostEvidence, "function");
    assert.strictEqual(typeof root.Storage.Service, "function");
    assert.strictEqual(typeof root.Storage.layerFromAsync, "function");
    assert.strictEqual(typeof root.Custody.layerConfig, "function");
    assert.strictEqual(typeof root.Principal.Service, "function");
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
    assert.strictEqual(typeof root.DomainKit.Error, "function");
    assert.strictEqual(typeof root.DomainKit.isError, "function");
    assert.strictEqual(typeof root.Reason.NotFound, "function");
    assert.isTrue(Schema.isSchema(root.Reason.Model));
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
