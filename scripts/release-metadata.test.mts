import { describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { classifyMetadata, git, object } from "./release-metadata.mts";
import { parse } from "jsonc-parser";
import { trustedVersionPr } from "./version-pr.mts";

import {
  historicalBase as base,
  historicalRelease as release,
  correctedLock,
  releaseFixture,
} from "./release-fixture.mts";
const baseLock = await git(["show", `${base}:bun.lock`]);
async function candidate(path: string, edit: (source: string) => string, mode?: string) {
  const fixture = await releaseFixture(async (directory) => {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    const source = (await Bun.file(target).exists()) ? await Bun.file(target).text() : "";
    await writeFile(target, edit(source));
    if (mode) await chmod(target, 0o755);
  });
  try {
    return await classifyMetadata(fixture.base, fixture.head, fixture.cwd);
  } finally {
    await rm(fixture.cwd, { recursive: true, force: true });
  }
}
function manifest(field: string, value: unknown) {
  return (source: string) => JSON.stringify({ ...object(JSON.parse(source)), [field]: value });
}
describe("release metadata diff", () => {
  test("accepts the real a60c360 release with only cached workspace metadata corrected", async () => {
    expect(await candidate("bun.lock", (source) => source)).toMatchObject({ metadataOnly: true });
  });
  test("qualifies the historical positive by changing only its four cached internal ranges", async () => {
    const expected = object(parse(await git(["show", `${release}:bun.lock`])));
    const workspaces = object(expected.workspaces);
    for (const workspace of ["apps/docs", "packages/react", "packages/capsuledb"]) {
      const dependencies = object(object(workspaces[workspace]).dependencies);
      dependencies.domainkit = "workspace:^0.21.0";
      if (workspace === "apps/docs") dependencies["@domainkit/react"] = "workspace:^0.21.0";
    }
    expect(parse(correctedLock)).toEqual(expected);
  });
  test("rejects raw a60c360 because its workspace ranges are stale", async () => {
    expect(await classifyMetadata(base, release)).toMatchObject({
      metadataOnly: false,
      reason: expect.stringContaining("Stale lockfile workspace range"),
    });
  });
  test("rejects one restored base lock range even when all bumped versions match", async () => {
    expect(
      await candidate("bun.lock", (source) =>
        source.replace('"workspace:^0.21.0"', '"workspace:^0.20.0"'),
      ),
    ).toMatchObject({
      metadataOnly: false,
      reason: expect.stringContaining("Stale lockfile workspace range"),
    });
  });
  for (const [name, path, edit] of [
    ["source", "packages/domainkit/src/index.ts", () => "throw new Error('changed');"],
    ["exports", "packages/domainkit/package.json", manifest("exports", { ".": "./arbitrary.mjs" })],
    [
      "external dependency",
      "packages/domainkit/package.json",
      manifest("dependencies", { oauth4webapi: "999.0.0" }),
    ],
    ["scripts", "packages/domainkit/package.json", manifest("scripts", { build: "echo unsafe" })],
    ["engine policy", "packages/domainkit/package.json", manifest("engines", { node: ">=99" })],
    ["arbitrary Tegami", ".tegami/config.json", () => "{}"],
    ["new release note", ".tegami/new.md", () => "---\npackages:\n  domainkit: patch\n---\nnew"],
    ["workflow", ".github/workflows/ci.yml", () => "jobs: {}"],
    ["root policy", "package.json", manifest("packageManager", "bun@9.0.0")],
    ["unsynchronized release", "packages/react/package.json", manifest("version", "0.22.0")],
    [
      "lockfile external package",
      "bun.lock",
      (source: string) => source.replace('"oauth4webapi@3.8.8"', '"oauth4webapi@99.0.0"'),
    ],
    [
      "lockfile workspace version",
      "bun.lock",
      (source: string) => source.replace('"version": "0.21.0"', '"version": "99.0.0"'),
    ],
    [
      "publish-lock policy",
      ".tegami/publish-lock.yaml",
      (source: string) => source + "arbitrary: true\n",
    ],
    [
      "changed note content",
      ".tegami/publish-lock.yaml",
      (source: string) => source.replace("Derive provider", "Forged provider"),
    ],
    [
      "rewritten changelog",
      "packages/domainkit/CHANGELOG.md",
      () => "## domainkit@0.21.0\nrewritten",
    ],
  ] as const)
    test(`rejects ${name}`, async () => {
      expect(await candidate(path, edit)).toMatchObject({ metadataOnly: false });
    });
  test("rejects omitted workspace lockfile version updates", async () => {
    expect(await candidate("bun.lock", () => baseLock)).toMatchObject({ metadataOnly: false });
  });
  test("rejects executable metadata", async () => {
    expect(
      await candidate("packages/react/package.json", (text) => text, "executable"),
    ).toMatchObject({ metadataOnly: false });
  });
  test("rejects a base not contained in the candidate", async () => {
    expect(await classifyMetadata(release, base)).toMatchObject({ metadataOnly: false });
  });
});

const currentBase = "a".repeat(40);
const trusted = {
  state: "open",
  user: { login: "github-actions[bot]", type: "Bot", id: 41898282 },
  base: { ref: "main", sha: currentBase, repo: { full_name: "AryaLabsHQ/domainkit" } },
  head: {
    ref: "tegami/version-packages",
    sha: "b".repeat(40),
    repo: { full_name: "AryaLabsHQ/domainkit" },
  },
};
test("recognizes only open same-repo bot version PRs at the current base", () => {
  expect(trustedVersionPr(trusted, currentBase)).toBe(true);
  for (const pr of [
    { ...trusted, state: "closed" },
    { ...trusted, user: { ...trusted.user, id: 1 } },
    { ...trusted, user: { ...trusted.user, type: "User" } },
    { ...trusted, head: { ...trusted.head, ref: "arbitrary" } },
    { ...trusted, head: { ...trusted.head, repo: { full_name: "fork/domainkit" } } },
    { ...trusted, base: { ...trusted.base, sha: "c".repeat(40) } },
  ])
    expect(trustedVersionPr(pr, currentBase)).toBe(false);
});
