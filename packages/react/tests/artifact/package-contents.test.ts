import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { satisfies } from "semver";

import corePackageJson from "../../../domainkit/package.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

describe("packed React package", () => {
  it("keeps the public artifact and peer contract explicit", async () => {
    expect(packageJson.type).toBe("module");
    expect(packageJson.peerDependencies.react).toBe(">=19.0.0 <20.0.0");
    expect(packageJson.peerDependencies["react-dom"]).toBe(">=19.0.0 <20.0.0");
    expect(packageJson.peerDependencies.effect).toBe(">=4.0.0-rc.112 <5.0.0");
    expect(packageJson.exports["."].types).toBe("./dist/index.d.mts");
    // Nothing in the package runs for its side effects, and there is no stylesheet to keep.
    expect(packageJson.sideEffects).toBe(false);
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["domainkit"]);

    const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const packages = JSON.parse(stdout) as ReadonlyArray<{
      readonly files: ReadonlyArray<{ readonly path: string }>;
    }>;
    const first = packages[0];
    if (first === undefined) throw new Error("npm pack returned no React package");
    const files = first.files.map(({ path }) => path).sort();
    const allowed = new Set([
      "LICENSE",
      "README.md",
      "dist/index.d.mts",
      "dist/index.mjs",
      "dist/index.mjs.map",
      "package.json",
    ]);
    expect(
      files.filter(
        (path) => !allowed.has(path) && !/^dist\/rolldown-runtime-[\w-]+\.mjs$/.test(path),
      ),
    ).toEqual([]);
  });

  it("ships hooks alone: no stylesheet, and no element vocabulary to style", async () => {
    const bundle = await readFile("dist/index.mjs", "utf8");
    expect(bundle).not.toContain("data-domainkit-part");
    expect(bundle).not.toContain("--domainkit-");
    expect(existsSync("dist/styles.css")).toBe(false);
  });

  it("declares a compatible packed DomainKit runtime", async () => {
    const sourceRange = packageJson.dependencies.domainkit;
    expect(sourceRange).toMatch(/^workspace:\^[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(satisfies(corePackageJson.version, sourceRange.slice("workspace:".length))).toBe(true);

    const directory = await mkdtemp(join(tmpdir(), "domainkit-react-package-"));
    try {
      const before = new Set(await readdir(directory));
      await execFileAsync("bun", ["pm", "pack", "--destination", directory], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const filename = (await readdir(directory)).find((candidate) => !before.has(candidate));
      if (filename === undefined) throw new Error("Bun pack returned no React package");
      const { stdout: manifest } = await execFileAsync(
        "tar",
        ["-xOf", join(directory, filename), "package/package.json"],
        { encoding: "utf8" },
      );
      const packedPackage = JSON.parse(manifest) as {
        readonly dependencies?: Readonly<Record<string, string>>;
      };
      const range = packedPackage.dependencies?.domainkit;
      expect(range).toBeDefined();
      expect(satisfies(corePackageJson.version, range ?? "")).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
