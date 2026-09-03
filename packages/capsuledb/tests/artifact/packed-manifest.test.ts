import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { assert, describe, it } from "@effect/vitest";

const execFileAsync = promisify(execFile);

describe("packed manifest", () => {
  it("keeps the exact development bridge out of runtime dependencies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domainkit-capsuledb-pack-"));
    try {
      const { stdout } = await execFileAsync(
        "npm",
        ["pack", "--json", "--pack-destination", directory],
        { cwd: join(import.meta.dirname, "..", "..") },
      );
      const packedFiles = JSON.parse(stdout) as ReadonlyArray<{ readonly filename: string }>;
      const filename = packedFiles[0]?.filename;
      if (filename === undefined) throw new Error("npm pack returned no filename");
      const { stdout: manifest } = await execFileAsync(
        "tar",
        ["-xOf", join(directory, filename), "package/package.json"],
        { encoding: "utf8" },
      );
      const packed = JSON.parse(manifest) as {
        readonly dependencies?: Readonly<Record<string, string>>;
        readonly devDependencies?: Readonly<Record<string, string>>;
        readonly peerDependencies?: Readonly<Record<string, string>>;
      };
      assert.strictEqual(
        packed.devDependencies?.capsuledb,
        "git+https://github.com/aryasaatvik/CapsuleDB.git#860ae859adb63f2af365cd6d785115270b35bff3",
      );
      assert.strictEqual(packed.dependencies?.capsuledb, undefined);
      assert.strictEqual(packed.peerDependencies?.capsuledb, ">=0.1.0 <0.2.0");
      assert.strictEqual(JSON.stringify(packed).includes("capsuledb-worktrees"), false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
