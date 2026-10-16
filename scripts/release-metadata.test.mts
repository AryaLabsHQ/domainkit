import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classifyMetadata, git, object } from "./release-metadata.mts";
import { trustedVersionPr } from "./version-pr.mts";

const release = "a60c360c068366b51f49ff1a19aa51104fc7fc21";
const base = (await git(["rev-parse", `${release}^`])).trim();
const baseLock = await git(["show", `${base}:bun.lock`]);
const root = await mkdtemp(join(tmpdir(), "domainkit-metadata-"));
afterAll(() => rm(root, { recursive: true, force: true }));
const paths = (await git(["ls-tree", "-r", "--name-only", base])).trim().split("\n")
  .filter((path) => path === "package.json" || path === "bun.lock" || path.startsWith(".tegami/") ||
    /^(?:(?:apps|packages)\/[^/]+|examples)\/(?:package.json|CHANGELOG.md)$/.test(path));
async function snapshot(ref: string, directory: string) {
  const existing = new Set((await git(["ls-tree", "-r", "--name-only", ref])).trim().split("\n"));
  await Promise.all(paths.map(async (path) => {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    if (existing.has(path)) await writeFile(target, await git(["show", `${ref}:${path}`]));
    else await rm(target, { force: true });
  }));
}
let fixture = 0;
async function candidate(path: string, edit: (source: string) => string, mode?: string) {
  const directory = join(root, String(fixture++));
  await mkdir(directory);
  await git(["init", "-q"], directory);
  await snapshot(base, directory);
  // This is a disposable Git fixture, never the repository's real index/config/hooks.
  await git(["config", "user.email", "fixture@example.invalid"], directory);
  await git(["config", "user.name", "Fixture"], directory);
  const commit = async () => {
    await git(["add", "--", ...paths.filter((entry) => entry !== ".tegami/.gitkeep")], directory);
    await git(["-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"], directory);
    return (await git(["rev-parse", "HEAD"], directory)).trim();
  };
  const from = await commit();
  await snapshot(release, directory);
  const target = join(directory, path);
  await mkdir(dirname(target), { recursive: true });
  const source = await Bun.file(target).exists() ? await Bun.file(target).text() : "";
  await writeFile(target, edit(source));
  await git(["add", "--", path], directory);
  if (mode) await chmod(target, 0o755);
  const to = await commit();
  return classifyMetadata(from, to, directory);
}
function manifest(field: string, value: unknown) {
  return (source: string) => JSON.stringify({ ...object(JSON.parse(source)), [field]: value });
}
describe("release metadata diff", () => {
  test("accepts the real a60c360 release, including internal range bumps and consumed notes", async () => {
    expect(await classifyMetadata(base, release)).toMatchObject({ metadataOnly: true });
  });
  for (const [name, path, edit] of [
    ["source", "packages/domainkit/src/index.ts", () => "throw new Error('changed');"],
    ["exports", "packages/domainkit/package.json", manifest("exports", { ".": "./arbitrary.mjs" })],
    ["external dependency", "packages/domainkit/package.json", manifest("dependencies", { oauth4webapi: "999.0.0" })],
    ["scripts", "packages/domainkit/package.json", manifest("scripts", { build: "echo unsafe" })],
    ["engine policy", "packages/domainkit/package.json", manifest("engines", { node: ">=99" })],
    ["arbitrary Tegami", ".tegami/config.json", () => "{}"],
    ["new release note", ".tegami/new.md", () => "---\npackages:\n  domainkit: patch\n---\nnew"],
    ["workflow", ".github/workflows/ci.yml", () => "jobs: {}"],
    ["root policy", "package.json", manifest("packageManager", "bun@9.0.0")],
    ["unsynchronized release", "packages/react/package.json", manifest("version", "0.22.0")],
    ["lockfile external package", "bun.lock", (source: string) => source.replace('"oauth4webapi@3.8.8"', '"oauth4webapi@99.0.0"')],
    ["lockfile workspace version", "bun.lock", (source: string) => source.replace('"version": "0.21.0"', '"version": "99.0.0"')],
    ["publish-lock policy", ".tegami/publish-lock.yaml", (source: string) => source + "arbitrary: true\n"],
    ["changed note content", ".tegami/publish-lock.yaml", (source: string) => source.replace("Derive provider", "Forged provider")],
    ["rewritten changelog", "packages/domainkit/CHANGELOG.md", () => "## domainkit@0.21.0\nrewritten"],
  ] as const) test(`rejects ${name}`, async () => {
    expect(await candidate(path, edit)).toMatchObject({ metadataOnly: false });
  });
  test("rejects omitted workspace lockfile version updates", async () => {
    expect(await candidate("bun.lock", () => baseLock)).toMatchObject({ metadataOnly: false });
  });
  test("rejects executable metadata", async () => {
    expect(await candidate("packages/react/package.json", (text) => text, "executable")).toMatchObject({ metadataOnly: false });
  });
  test("rejects a base not contained in the candidate", async () => {
    expect(await classifyMetadata(release, base)).toMatchObject({ metadataOnly: false });
  });
});

const currentBase = "a".repeat(40);
const trusted = {
  state: "open", user: { login: "github-actions[bot]", type: "Bot", id: 41898282 },
  base: { ref: "main", sha: currentBase, repo: { full_name: "AryaLabsHQ/domainkit" } },
  head: { ref: "tegami/version-packages", sha: "b".repeat(40), repo: { full_name: "AryaLabsHQ/domainkit" } },
};
test("recognizes only open same-repo bot version PRs at the current base", () => {
  expect(trustedVersionPr(trusted, currentBase)).toBe(true);
  for (const pr of [
    { ...trusted, state: "closed" }, { ...trusted, user: { ...trusted.user, id: 1 } },
    { ...trusted, user: { ...trusted.user, type: "User" } },
    { ...trusted, head: { ...trusted.head, ref: "arbitrary" } },
    { ...trusted, head: { ...trusted.head, repo: { full_name: "fork/domainkit" } } },
    { ...trusted, base: { ...trusted.base, sha: "c".repeat(40) } },
  ]) expect(trustedVersionPr(pr, currentBase)).toBe(false);
});
