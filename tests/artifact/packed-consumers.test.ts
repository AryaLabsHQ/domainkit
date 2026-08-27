import { describe, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";

const execFileAsync = promisify(execFile);

const PackResult = Schema.Array(Schema.Struct({ filename: Schema.String }));

describe("packed consumers", () => {
  it("runs the Promise and Effect namespaces in Node, Bun, and a browser bundle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domainkit-consumer-"));
    try {
      const packOutput = await run(["npm", "pack", "--json", "--pack-destination", directory]);
      const packed = Schema.decodeUnknownSync(PackResult)(JSON.parse(packOutput));
      const filename = packed[0]?.filename;
      if (filename === undefined) throw new Error("npm pack returned no filename");

      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ name: "domainkit-packed-consumer", private: true, type: "module" }),
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
import { Provisioning, VERSION } from "domainkit";
import { Effect, Layer } from "effect";
import {
  Digest,
  DnsProvider,
  Provisioning as EffectProvisioning,
} from "domainkit/effect";

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
  zone: "example.com",
};
const promisePlan = await Provisioning.create({ ...input, provider });
const effectPlan = await Effect.runPromise(
  EffectProvisioning.create(input).pipe(
    Effect.provide(
      Layer.merge(DnsProvider.layerFromAsync(provider), Digest.webCryptoLayer),
    ),
  ),
);
if (VERSION.length === 0 || promisePlan.digest !== effectPlan.digest) {
  throw new Error("Packed Promise and Effect namespaces diverged");
}
`,
      );

      await run(["node", "consumer.mjs"], directory);
      await run(["bun", "consumer.mjs"], directory);
      await run(
        ["bun", "build", "consumer.mjs", "--outdir", "browser-build", "--target", "browser"],
        directory,
      );
    } finally {
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
