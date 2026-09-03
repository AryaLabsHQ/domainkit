import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { assert, describe, it } from "@effect/vitest";

const execFileAsync = promisify(execFile);

const packageRoot = join(import.meta.dirname, "..", "..");

interface Packed {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
}

const pack = async (directory: string) => {
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", directory],
    {
      cwd: packageRoot,
    },
  );
  const packedFiles = JSON.parse(stdout) as ReadonlyArray<{ readonly filename: string }>;
  const filename = packedFiles[0]?.filename;
  if (filename === undefined) throw new Error("npm pack returned no filename");
  const tarball = join(directory, filename);
  const [{ stdout: manifest }, { stdout: listing }] = await Promise.all([
    execFileAsync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }),
    execFileAsync("tar", ["-tf", tarball], { encoding: "utf8" }),
  ]);
  return { packed: JSON.parse(manifest) as Packed, files: listing.split("\n") };
};

describe("packed manifest", () => {
  it("keeps the development pin out of the runtime dependency graph", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domainkit-capsuledb-pack-"));
    try {
      const { packed } = await pack(directory);
      // The pin stays a devDependency until capsuledb@0.2 is published; a consumer resolves
      // `capsuledb` through the peer range, never through a Git URL.
      assert.strictEqual(
        packed.devDependencies?.capsuledb,
        "git+https://github.com/aryasaatvik/CapsuleDB.git#94777cfdcf5cca5dce1a4abe5db9665e0630a00f",
      );
      assert.strictEqual(packed.dependencies?.capsuledb, undefined);
      assert.ok(packed.peerDependencies?.capsuledb !== undefined, "capsuledb stays a peer");
      assert.strictEqual(JSON.stringify(packed).includes("capsuledb-worktrees"), false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("ships one root entry that resolves to built output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domainkit-capsuledb-pack-"));
    try {
      const { packed, files } = await pack(directory);
      assert.deepStrictEqual(Object.keys(packed.exports ?? {}), [".", "./package.json"]);
      assert.deepStrictEqual(packed.exports?.["."], {
        types: "./dist/index.d.mts",
        import: "./dist/index.mjs",
      });
      for (const file of ["package/dist/index.mjs", "package/dist/index.d.mts"]) {
        assert.ok(files.includes(file), `the tarball ships ${file}`);
      }
      assert.ok(files.includes("package/README.md"), "the tarball ships the README");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
