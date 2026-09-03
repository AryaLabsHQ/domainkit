import { assert, describe, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Schema } from "effect";

import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

const PackResult = Schema.Array(
  Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) }),
);

const exportTargets = Object.values(packageJson.exports).flatMap((target) =>
  typeof target === "string" ? [] : [target.types, target.import],
);
const requiredFiles = new Set([
  "LICENSE",
  "README.md",
  "package.json",
  ...exportTargets.map((target) => target.replace(/^\.\//, "")),
]);

const generatedSuffixes = [".d.ts", ".mjs", ".mjs.map"];

describe("packed package contents", () => {
  it("keeps runtime and peer metadata portable", () => {
    assert.strictEqual(packageJson.type, "module");
    assert.strictEqual(packageJson.sideEffects, false);
    assert.strictEqual(packageJson.engines.node, ">=24.10.0");
    assert.strictEqual(packageJson.peerDependencies.effect, ">=4.0.0-rc.112 <5.0.0");
    assert.strictEqual("effect" in packageJson.dependencies, false);
    assert.strictEqual("executor" in packageJson.dependencies, false);

    for (const [subpath, target] of Object.entries(packageJson.exports)) {
      if (typeof target === "string") continue;
      assert.ok(target.import.startsWith("./dist/"), `${subpath} import must target dist`);
      assert.ok(target.types.startsWith("./dist/"), `${subpath} types must target dist`);
    }
  });

  it("matches the explicit artifact allowlist", async () => {
    const output = await run(["npm", "pack", "--dry-run", "--json"]);
    const packages = Schema.decodeUnknownSync(PackResult)(JSON.parse(output));
    const first = packages[0];
    if (first === undefined) throw new Error("npm pack returned no package result");
    const files = first.files.map(({ path }) => path).sort();

    const unexpected = files.filter(
      (path) =>
        !requiredFiles.has(path) &&
        !(path.startsWith("dist/") && generatedSuffixes.some((suffix) => path.endsWith(suffix))),
    );
    const missing = [...requiredFiles].filter((path) => !files.includes(path));
    assert.deepStrictEqual(unexpected, []);
    assert.deepStrictEqual(missing, []);
  });
});

async function run(command: ReadonlyArray<string>): Promise<string> {
  const executable = command[0];
  if (executable === undefined) throw new Error("Artifact command is empty");
  const { stdout } = await execFileAsync(executable, command.slice(1), { encoding: "utf8" });
  return stdout;
}
