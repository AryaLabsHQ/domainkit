import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackagePublishTask, PublishTask, tegami, type TegamiPlugin } from "tegami";
import { releaseChecks } from "./release-gate.mts";

// The installed Tegami lifecycle runs unchanged; only remote publication/tag/release tasks are local.
async function fixture(broken: boolean) {
  const cwd = await mkdtemp(join(tmpdir(), "domainkit-release-gate-"));
  const marker = join(cwd, "writes");
  await mkdir(join(cwd, "dist"));
  await mkdir(join(cwd, ".tegami"));
  await writeFile(join(cwd, "dist/index.mjs"), "export const ready = true;");
  await writeFile(join(cwd, "package.json"), JSON.stringify({
    name: "domainkit", version: "1.0.0", type: "module", files: ["dist"],
    exports: broken ? "./missing.mjs" : "./dist/index.mjs",
    scripts: { "release:check": "bun check.mjs" },
  }));
  await writeFile(join(cwd, ".tegami/publish-lock.yaml"), "core:packages:\n  - id: npm:domainkit\n    updated: true\nnpm:packages:\n  - id: npm:domainkit\n");
  await writeFile(join(cwd, "check.mjs"), `
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "domainkit-gate-consumer-"));
async function run(args, cwd) {
  const child = Bun.spawn(["bun", ...args], { cwd, stdout: "ignore", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error("Packed artifact gate failed");
}
try {
  await run(["pm", "pack", "--destination", directory], process.cwd());
  const tarball = (await readdir(directory)).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("Missing tarball");
  await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { domainkit: "file:" + join(directory, tarball) } }));
  await run(["install", "--ignore-scripts"], directory);
  await run(["-e", "const { ready } = await import('domainkit'); if (!ready) throw new Error('Invalid artifact');"], directory);
} finally { await rm(directory, { recursive: true, force: true }); }
`);
  const effects: string[] = [];
  class LocalPublish extends PackagePublishTask {
    override status() { effects.push("remote-status"); return "pending" as const; }
    async publish() { await writeFile(marker, "npm"); effects.push("npm"); return { type: "published" as const }; }
  }
  class LocalRelease extends PublishTask {
    name = "tag-and-release";
    async run() { await writeFile(marker, "npm,tag,release"); effects.push("tag", "release"); }
    override status() { return "pending" as const; }
  }
  const boundary: TegamiPlugin = {
    name: "local-remote-boundary",
    publishPreflight() { return { shouldPublish: true }; },
    publishTasks() {
      const pkg = this.graph.get("npm:domainkit");
      if (!pkg) throw new Error("Missing fixture package");
      const publish = new LocalPublish(pkg), release = new LocalRelease();
      release.wait.push(publish);
      return [publish, release];
    },
  };
  const paper = tegami({ cwd });
  const context = await paper._internal.context();
  context.plugins.splice(0, context.plugins.length, releaseChecks(), boundary);
  return { cwd, marker, effects, paper };
}

test("broken installed exports block npm/tag/release tasks and remote status", async () => {
  const { cwd, marker, effects, paper } = await fixture(true);
  try {
    await expect(paper.publish()).rejects.toThrow("DomainKit release gate failed");
    expect(effects).toEqual([]);
    expect(await Bun.file(marker).exists()).toBe(false);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 20_000);

test("valid installed artifact permits downstream local publication tasks", async () => {
  const { cwd, marker, effects, paper } = await fixture(false);
  try {
    await paper.publish();
    expect(await readFile(marker, "utf8")).toBe("npm,tag,release");
    expect(effects).toEqual(["remote-status", "npm", "tag", "release"]);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 20_000);

test("status and dry-run also invoke the artifact gate", async () => {
  const { cwd, effects, paper } = await fixture(true);
  try {
    await expect(paper.getPublishStatus()).rejects.toThrow("DomainKit release gate failed");
    await expect(paper.publish({ dryRun: true })).rejects.toThrow("DomainKit release gate failed");
    expect(effects).toEqual([]);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 20_000);
