import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "domainkit-consumer-"));

try {
  const packOutput = await run(["npm", "pack", "--json", "--pack-destination", directory]);
  const packed = JSON.parse(packOutput) as ReadonlyArray<{ readonly filename: string }>;
  const filename = packed[0]?.filename;
  if (filename === undefined) throw new Error("npm pack did not return a tarball filename");

  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "domainkit-packed-consumer", private: true, type: "module" }),
  );
  await run(
    ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, filename)],
    directory,
  );
  await writeFile(
    join(directory, "consumer.mjs"),
    `
import { createPlan, VERSION } from "domainkit";
import { Effect, Layer } from "effect";
import {
  createPlan as createPlanEffect,
  layerDnsProviderFromPromise,
  webCryptoLayer,
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
const promisePlan = await createPlan({ ...input, provider });
const effectPlan = await Effect.runPromise(
  createPlanEffect(input).pipe(
    Effect.provide(Layer.merge(layerDnsProviderFromPromise(provider), webCryptoLayer)),
  ),
);
if (VERSION.length === 0 || promisePlan.digest !== effectPlan.digest) {
  throw new Error("Packed Promise and Effect entry points diverged");
}
`,
  );

  await run(["node", "consumer.mjs"], directory);
  await run(["bun", "consumer.mjs"], directory);
  const build = await Bun.build({
    entrypoints: [join(directory, "consumer.mjs")],
    outdir: join(directory, "browser-build"),
    target: "browser",
  });
  if (!build.success) {
    throw new Error(`Browser/Workers-compatible bundle failed: ${build.logs.join("\n")}`);
  }
  console.log("Packed consumers passed in Node 24, Bun, and a browser/Workers bundle.");
} finally {
  await rm(directory, { force: true, recursive: true });
}

async function run(command: ReadonlyArray<string>, cwd = process.cwd()): Promise<string> {
  const child = Bun.spawn([...command], { cwd, stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed (${exitCode}):\n${stderr || stdout}`);
  }
  return stdout;
}
