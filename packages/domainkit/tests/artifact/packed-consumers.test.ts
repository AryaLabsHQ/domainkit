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

/**
 * The lifecycle every consumer runs: connect a fake provider, plan, approve, apply, observe, then
 * read the same domain back through the mounted server group.
 */
const lifecycle = `
import { Cloudflare, Connect, Custody, DnsRecord, DomainKit, Principal, Provision, Vercel, Verify, VERSION } from "domainkit";
import { Transport } from "domainkit/client";
import { Server } from "domainkit/server";
import { Testing } from "domainkit/testing";
import { Effect, Layer } from "effect";

export const run = async () => {
  const fake = Testing.provider({ zones: ["example.com"] });
  const services = DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() });
  const program = Effect.gen(function* () {
    const started = yield* Connect.start({
      provider: fake.id,
      method: Connect.Method.token("packed-token"),
      domain: "app.example.com",
    });
    const plan = yield* Provision.plan({
      domain: "app.example.com",
      requirements: [DnsRecord.txt({ name: "_verify.app.example.com", value: "domainkit" })],
    });
    const receipt = yield* Provision.apply(yield* Provision.approve(plan));
    const readiness = yield* Verify.observe({ domain: "app.example.com" });
    return {
      started: started._tag,
      operations: plan.operations.map(({ _tag }) => _tag),
      status: receipt.status,
      overall: readiness.overall,
      providers: [Cloudflare.provider().id, Vercel.provider().id],
      keyLength: Custody.generateKey().length,
      version: VERSION,
    };
  }).pipe(
    Effect.provideService(Principal.Service, Testing.principal),
    Effect.provide(services),
  );
  const lifecycleResult = await Effect.runPromise(program);

  // The mounted group and the fetch transport over their own store: a second connect, over HTTP.
  const { handler, dispose } = Server.toWebHandler(
    DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() }).pipe(
      Layer.merge(
        Layer.succeed(Server.Identity)({ principal: () => Effect.succeed(Testing.principal) }),
      ),
    ),
    { prefix: "/api/domainkit" },
  );
  try {
    const transport = Transport.fromFetch("https://consumer.example/api/domainkit", {
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const wired = await Effect.runPromise(
      transport.connection.start({
        domain: "site.example.com",
        provider: fake.id,
        method: Transport.Method.token("packed-token"),
      }),
    );
    return {
      ...lifecycleResult,
      wired: wired._tag,
      snapshot: wired.snapshot.status,
      capabilities: Transport.capabilities(transport),
    };
  } finally {
    await dispose();
  }
};
`;

const expected = (version: string) => ({
  started: "Connected",
  operations: ["Create"],
  status: "complete",
  overall: "ready",
  providers: ["cloudflare", "vercel"],
  keyLength: 43,
  version,
  wired: "Connected",
  snapshot: "connected",
  capabilities: ["connection", "provisioning", "verification", "cleanup"],
});

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
          dependencies: { effect: "4.0.0-rc.112" },
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
      await writeFile(join(directory, "lifecycle.mjs"), lifecycle);
      await writeFile(
        join(directory, "consumer.mjs"),
        `
import { run } from "./lifecycle.mjs";
const result = await run();
const expected = ${JSON.stringify(expected(packageJson.version))};
if (JSON.stringify(result) !== JSON.stringify(expected)) {
  throw new Error("Packed lifecycle diverged: " + JSON.stringify(result));
}
`,
      );

      await writeFile(
        join(directory, "types.ts"),
        `
import { Effect, Layer, Redacted } from "effect";
import { Custody, DomainKit, type Provider, type Storage } from "domainkit";
import { Transport } from "domainkit/client";
import { Server } from "domainkit/server";
import { Testing } from "domainkit/testing";

export type PublicProvider = Provider.Definition;
export type PublicStorage = Storage.Interface;
export type PublicAsyncStorage = Storage.AsyncInterface;
export type PublicError = DomainKit.Error;
export type Fake = Testing.FakeProvider;

export const live: Layer.Layer<DomainKit.Services, DomainKit.Error, Storage.Service> =
  DomainKit.layer({ providers: [Testing.provider()] }).pipe(
    Layer.provide(Custody.layer({ key: Redacted.make(Custody.generateKey()) })),
  );
export const cases = Testing.conformance.storage(Testing.storage).map((item) => item.name);
export type PublicIdentity = Server.IdentityService;
export type PublicSnapshot = Server.Snapshot;
export type PublicStarted = Server.Started;
export type PublicReadiness = Server.Readiness;
export const routes = Object.keys(Server.api.groups);
export type PublicTransport = Transport.Transport;
/** A host that exposes only connection routes still gets a transport that typechecks. */
export const connectionOnly: Transport.Transport = {
  connection: {
    inspect: () => Effect.die("unused"),
    start: () => Effect.die("unused"),
    attach: () => Effect.die("unused"),
    detach: () => Effect.die("unused"),
    disconnect: () => Effect.die("unused"),
  },
};
export const groups = Transport.capabilities(connectionOnly);
export const noRuntimeExit: Effect.Effect<void, unknown> = Effect.void;
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
            lib: ["ES2024", "DOM"],
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
import { run } from "./lifecycle.mjs";

export default {
  async fetch() {
    return Response.json(await run());
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
      assert.deepStrictEqual(await response.json(), expected(packageJson.version));
    } finally {
      await miniflare?.dispose();
      await rm(directory, { force: true, recursive: true });
    }
  }, 90_000);
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
