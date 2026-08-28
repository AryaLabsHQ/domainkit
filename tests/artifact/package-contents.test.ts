import { assert, describe, it } from "@effect/vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Schema } from "effect";

const execFileAsync = promisify(execFile);

const PackResult = Schema.Array(
  Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) }),
);

const requiredFiles = new Set([
  "LICENSE",
  "README.md",
  "dist/cloudflare.d.mts",
  "dist/cloudflare.mjs",
  "dist/effect.d.mts",
  "dist/effect-cloudflare.d.mts",
  "dist/effect-cloudflare.mjs",
  "dist/effect-vercel.d.mts",
  "dist/effect-vercel.mjs",
  "dist/effect.mjs",
  "dist/index.d.mts",
  "dist/index.mjs",
  "dist/testing.d.mts",
  "dist/testing.mjs",
  "dist/vercel.d.mts",
  "dist/vercel.mjs",
  "package.json",
]);

const generatedSuffixes = [".d.mts", ".d.mts.map", ".mjs", ".mjs.map"];

describe("packed package contents", () => {
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
