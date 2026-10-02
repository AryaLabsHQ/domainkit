import { assert, describe, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "../..");

const run = async (command: string, args: ReadonlyArray<string>, cwd: string) => {
  try {
    return await execFileAsync(command, args, { cwd, encoding: "utf8" });
  } catch (cause) {
    if (cause instanceof Error && "stdout" in cause && "stderr" in cause) {
      throw new Error(`${cause.message}\n${cause.stdout}\n${cause.stderr}`, { cause });
    }
    throw cause;
  }
};

const pack = async (cwd: string, directory: string) => {
  const before = new Set(await readdir(directory));
  await run("bun", ["pm", "pack", "--destination", directory], cwd);
  const filename = (await readdir(directory)).find((name) => !before.has(name));
  if (filename === undefined) throw new Error("bun pack returned no filename");
  return join(directory, filename);
};

describe("packed PostgreSQL integration consumer", () => {
  it("compiles declarations and runs the public manifest with published peers", async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "domainkit-capsuledb-consumer-")),
    );
    try {
      const core = await pack(resolve(packageRoot, "../domainkit"), directory);
      const integration = await pack(packageRoot, directory);
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: "domainkit-capsuledb-packed-consumer",
          private: true,
          type: "module",
          dependencies: {
            "@domainkit/capsuledb": `file:${integration}`,
            domainkit: `file:${core}`,
            capsuledb: "0.5.0",
            effect: "4.0.0",
          },
          overrides: { domainkit: `file:${core}` },
        }),
      );
      await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], directory);
      const installed = join(directory, "node_modules/@domainkit/capsuledb");
      assert.ok((await realpath(installed)).startsWith(`${directory}/`));
      await writeFile(
        join(directory, "types.ts"),
        `import { PgStorage, capsule } from "@domainkit/capsuledb";
import type { Capsule, Manifest, Registry } from "capsuledb";
import type { Storage } from "domainkit";
import type { Effect, Layer } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";

export const storage: Layer.Layer<Storage.Service, Registry.RegistryRuntimeError, SqlClient.SqlClient> =
  PgStorage.layer({ mode: "assert", readiness: "first-use", prefix: "packed", registryPrefix: "packed_ledger" });
export const declaration: Capsule.Capsule<Storage.Service, never, SqlClient.SqlClient> = capsule;
export const manifest: Effect.Effect<Manifest.Manifest, Registry.RegistryError> =
  PgStorage.manifest({ prefix: "packed", registryPrefix: "packed_ledger" });
`,
      );
      await writeFile(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            exactOptionalPropertyTypes: true,
            module: "Preserve",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            target: "ES2024",
            lib: ["ES2024", "ESNext.Disposable", "DOM"],
          },
          include: ["types.ts"],
        }),
      );
      const compiler = resolve(packageRoot, "node_modules/.bin/tsc");
      await run(compiler, ["--project", "tsconfig.json"], directory);
      await writeFile(
        join(directory, "consumer.mjs"),
        `import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PgStorage, capsule, VERSION } from "@domainkit/capsuledb";
import { Pg, Registry } from "capsuledb";
import { Effect } from "effect";

const require = createRequire(import.meta.url);
for (const name of ["@domainkit/capsuledb", "domainkit", "capsuledb", "effect"]) {
  const entry = realpathSync(fileURLToPath(import.meta.resolve(name)));
  assert.ok(entry.startsWith(${JSON.stringify(`${directory}/`)}), entry);
  assert.ok(!entry.includes("/src/"), entry);
}
assert.equal(require("capsuledb/package.json").version, "0.5.0");
assert.equal(require("effect/package.json").version, "4.0.0");
assert.equal(require("domainkit/package.json").version, ${JSON.stringify(packageJson.version)});
assert.equal(VERSION, ${JSON.stringify(packageJson.version)});
const actual = await Effect.runPromise(PgStorage.manifest());
const selected = await Effect.runPromise(Registry.manifest({ provider: Pg.profile, capsules: [capsule] }));
assert.deepEqual(actual, selected);
assert.equal(actual.capsules.length, 1);
const custom = await Effect.runPromise(PgStorage.manifest({ prefix: "packed", registryPrefix: "packed_ledger" }));
assert.notEqual(custom.fingerprint, actual.fingerprint);
`,
      );
      await run("node", ["consumer.mjs"], directory);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 120_000);
});
