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
  it("resolves capsuledb through the peer range, not a workspace path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domainkit-capsuledb-pack-"));
    try {
      const { packed } = await pack(directory);
      // The host installs one capsuledb and this package binds to it, so a consumer can never end
      // up with two copies of the registry.
      assert.strictEqual(packed.peerDependencies?.capsuledb, ">=0.2.0 <0.3.0");
      assert.strictEqual(packed.dependencies?.capsuledb, undefined);
      // Nothing a consumer installs may come from a Git URL or a local checkout.
      const ranges = Object.values({
        ...packed.dependencies,
        ...packed.devDependencies,
        ...packed.peerDependencies,
      });
      for (const range of ranges) {
        assert.strictEqual(range.startsWith("git+"), false, `${range} is a Git dependency`);
        assert.strictEqual(range.includes("worktrees"), false, `${range} is a local checkout`);
        assert.strictEqual(range.startsWith("file:"), false, `${range} is a local checkout`);
      }
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
