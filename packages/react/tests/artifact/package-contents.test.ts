import { execFile } from "node:child_process";
import { promisify } from "node:util";

import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

describe("packed React package", () => {
  it("keeps the public artifact and peer contract explicit", async () => {
    expect(packageJson.type).toBe("module");
    expect(packageJson.peerDependencies.react).toBe(">=19.0.0 <20.0.0");
    expect(packageJson.peerDependencies["react-dom"]).toBe(">=19.0.0 <20.0.0");
    expect(packageJson.peerDependencies["@effect/atom-react"]).toBe(">=4.0.0-rc.112 <5.0.0");
    expect(packageJson.peerDependencies.effect).toBe(">=4.0.0-rc.112 <5.0.0");
    expect(packageJson.exports["./styles.css"]).toBe("./dist/styles.css");

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
      "dist/styles.css",
      "package.json",
    ]);
    expect(
      files.filter(
        (path) => !allowed.has(path) && !/^dist\/rolldown-runtime-[\w-]+\.mjs$/.test(path),
      ),
    ).toEqual([]);
    expect(files).toContain("dist/styles.css");
  });
});
