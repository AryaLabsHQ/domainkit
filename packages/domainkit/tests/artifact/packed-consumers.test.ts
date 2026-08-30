import { assert, describe, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";
import { Miniflare } from "miniflare";

import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

const PackResult = Schema.Array(Schema.Struct({ filename: Schema.String }));

describe("packed consumers", () => {
  it("runs public artifact code in Node 24, Bun, and workerd", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domainkit-consumer-"));
    let miniflare: Miniflare | undefined;
    try {
      const packOutput = await run(["npm", "pack", "--json", "--pack-destination", directory]);
      const packed = Schema.decodeUnknownSync(PackResult)(JSON.parse(packOutput));
      const filename = packed[0]?.filename;
      if (filename === undefined) throw new Error("npm pack returned no filename");

      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: "domainkit-packed-consumer",
          private: true,
          type: "module",
          dependencies: { effect: "4.0.0-rc.111" },
        }),
      );
      await run(
        [
          "npm",
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          join(directory, filename),
        ],
        directory,
      );
      await writeFile(
        join(directory, "consumer.mjs"),
        `
import {
  Cloudflare,
  Digest,
  DnsProvider,
  Provisioning as EffectProvisioning,
  Vercel,
  VERSION,
} from "domainkit";
import {
  AuthorizationLifecycle,
  Cloudflare as PromiseCloudflare,
  Connection,
  ProviderAuthorization,
  Provisioning,
  Secret,
  Vercel as PromiseVercel,
  Verification,
  VERSION as PROMISE_VERSION,
} from "domainkit/promise";
import { InMemoryAuthorizationLifecycle } from "domainkit/testing";
import { Effect, Layer } from "effect";

const provider = {
  id: "packed-consumer",
  listRecords: async () => [],
  createRecord: async () => ({ providerRecordId: "record-1" }),
};
const input = {
  requirements: [{
    _tag: "TXT",
    metadata: { ownership: "consumer", provenance: "pack", purpose: "artifact proof" },
    name: "_verify.example.com",
    policy: "append",
    ttl: 300,
    value: "domainkit",
  }],
  target: Provisioning.Target.ExactZone({ zone: "example.com" }),
};
const { plan: promisePlan } = await Provisioning.create({ ...input, provider });
const discovered = await Provisioning.create({
  requirements: input.requirements,
  sources: [{
    provider,
    listZones: async (name) => name === "example.com" ? [{
      accountId: "packed-account",
      id: "packed-zone",
      name: "example.com",
      nameservers: ["ns1.example.net"],
      status: "active",
    }] : [],
  }],
  target: Provisioning.Target.DiscoverFromDomain({ domain: "mail.example.com" }),
});
if (discovered._tag !== "Resolved") throw new Error("Packed discovery did not resolve");
const repository = AuthorizationLifecycle.toAsync(InMemoryAuthorizationLifecycle.make());
const connected = await Connection.start({
  authorizedById: "packed-user",
  grant: { _tag: "account", excludedDomains: [] },
  method: Connection.Method.Token({
    authenticate: async () => ({
      capabilityEvidence: [
        { capability: "dns:read", evidence: ProviderAuthorization.Evidence.Declared() },
        { capability: "dns:write", evidence: ProviderAuthorization.Evidence.Declared() },
      ],
      credential: { accessToken: Secret.make("packed-token"), refreshToken: null, tokenType: "bearer" },
      expiresAt: null,
      providerAccountId: "packed-account",
      providerContext: { value: {}, version: "packed.v1" },
      scopes: [],
    }),
    providerId: provider.id,
    requiredCapabilities: ["dns:read", "dns:write"],
    token: Secret.make("packed-token"),
  }),
  ownerId: "packed-owner",
  repository,
});
if (connected._tag !== "Connected") throw new Error("Packed connection did not complete");
const binding = connected.aggregate.bindings[0];
if (binding === undefined) throw new Error("Packed connection has no owner binding");
const removed = await Connection.removeDomain({
  connectionId: binding.id,
  domain: "mail.example.com",
  ownerId: "packed-owner",
  repository,
});
const observed = await Verification.observe({
  record: input.requirements[0],
  resolvers: [{
    id: "packed-resolver",
    resolver: { resolve: async () => ({
      _tag: "answer",
      answers: [{
        data: "domainkit",
        name: "_verify.example.com",
        ttl: 60,
        type: "TXT",
      }],
    }) },
  }],
});
const cloudflareOptions = {
  accountId: "packed-account",
  capabilities: ["dns:read", "dns:write"],
  fetch: async () => { throw new Error("not called"); },
  token: Secret.make("packed-token"),
};
const cloudflare = PromiseCloudflare.make(cloudflareOptions);
const effectCloudflare = Cloudflare.make(cloudflareOptions);
const vercelOptions = {
  capabilities: ["dns:read", "dns:write"],
  context: { _tag: "personal" },
  fetch: async () => { throw new Error("not called"); },
  token: Secret.make("packed-token"),
};
const vercel = PromiseVercel.make(vercelOptions);
const effectVercel = Vercel.make(vercelOptions);
const { plan: effectPlan } = await Effect.runPromise(
  EffectProvisioning.create(input).pipe(
    Effect.provide(
      Layer.merge(DnsProvider.layerFromAsync(provider), Digest.webCryptoLayer),
    ),
  ),
);
if (
  VERSION.length === 0 ||
  VERSION !== PROMISE_VERSION ||
  connected._tag !== "Connected" ||
  removed._tag !== "Removed" ||
  discovered.plan.digest !== promisePlan.digest ||
  observed._tag !== "Verified" ||
  promisePlan.digest !== effectPlan.digest ||
  cloudflare.id !== "cloudflare" ||
  effectCloudflare.id !== "cloudflare" ||
  vercel.id !== "vercel" ||
  effectVercel.id !== "vercel"
) {
  throw new Error("Packed Promise and Effect namespaces diverged");
}
`,
      );

      await writeFile(
        join(directory, "types.ts"),
        `
import type { Cloudflare, DnsProvider, Vercel } from "domainkit";
import type {
  Cloudflare as PromiseCloudflare,
  Vercel as PromiseVercel,
} from "domainkit/promise";

export type PublicProvider = DnsProvider.Interface;
export type PublicProviders =
  | Cloudflare.Interface
  | PromiseCloudflare.Interface
  | Vercel.Interface
  | PromiseVercel.Interface;
`,
      );
      await writeFile(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            exactOptionalPropertyTypes: true,
            module: "Preserve",
            moduleResolution: "Bundler",
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: "ES2024",
          },
          include: ["types.ts"],
        }),
      );
      await run(
        [join(process.cwd(), "node_modules", ".bin", "tsc"), "--project", "tsconfig.json"],
        directory,
      );

      await run(["node", "consumer.mjs"], directory);
      await run(["bun", "consumer.mjs"], directory);
      await writeFile(
        join(directory, "worker.mjs"),
        `
import { DnsRecord, DnsResolverPool, DomainName, Verification, VERSION } from "domainkit";

export default {
  async fetch() {
    const domain = DomainName.parse("Example.COM.");
    const record = DnsRecord.parse({
      _tag: "TXT",
      metadata: { ownership: "consumer", provenance: "workerd", purpose: "artifact proof" },
      name: "_verify.example.com",
      policy: "append",
      ttl: 300,
      value: "domainkit",
    });
    const policy = DnsResolverPool.Policy.AnyMatch();
    return Response.json({
      domain,
      observe: typeof Verification.observe,
      policy: policy._tag,
      type: record._tag,
      version: VERSION,
    });
  },
};
`,
      );
      await run(
        ["bun", "build", "worker.mjs", "--outdir", "worker-build", "--target", "browser"],
        directory,
      );
      miniflare = new Miniflare({
        compatibilityDate: "2025-07-18",
        modules: true,
        script: await readFile(join(directory, "worker-build", "worker.js"), "utf8"),
      });
      const response = await miniflare.dispatchFetch("https://worker.example/");
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        domain: "example.com",
        observe: "function",
        policy: "AnyMatch",
        type: "TXT",
        version: packageJson.version,
      });
    } finally {
      await miniflare?.dispose();
      await rm(directory, { force: true, recursive: true });
    }
  }, 60_000);
});

async function run(command: ReadonlyArray<string>, cwd = process.cwd()): Promise<string> {
  const executable = command[0];
  if (executable === undefined) throw new Error("Artifact command is empty");
  const { stdout } = await execFileAsync(executable, command.slice(1), {
    cwd,
    encoding: "utf8",
  });
  return stdout;
}
