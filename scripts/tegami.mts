#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { tegami, type TegamiPlugin } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

import rootPackage from "../packages/domainkit/package.json" with { type: "json" };

const CORE_PACKAGE_ID = "npm:domainkit";
const REACT_PACKAGE_ID = "npm:@domainkit/react";
const CAPSULEDB_PACKAGE_ID = "npm:@domainkit/capsuledb";
const REPOSITORY = "AryaLabsHQ/domainkit";

if (rootPackage.name !== "domainkit") throw new Error("Unexpected release package");

const releaseChecks = (): TegamiPlugin => ({
  name: "domainkit-release-checks",
  enforce: "pre",
  async afterPreflight({ plan }) {
    const shouldPublish = [CORE_PACKAGE_ID, REACT_PACKAGE_ID, CAPSULEDB_PACKAGE_ID].some(
      (packageId) => plan.packages.get(packageId)?.preflight?.shouldPublish === true,
    );
    if (!shouldPublish) return;

    const child = Bun.spawn(["bun", "run", "release:check"], {
      cwd: this.cwd,
      stderr: "inherit",
      stdout: "inherit",
    });
    if ((await child.exited) !== 0) throw new Error("DomainKit release gate failed");
  },
});

const versionTag = (): TegamiPlugin => ({
  name: "domainkit-version-tag",
  enforce: "post",
  initPublishPlan({ plan }) {
    for (const [packageId, tag] of [
      [CORE_PACKAGE_ID, (version: string) => `v${version}`],
      [REACT_PACKAGE_ID, (version: string) => `@domainkit/react@${version}`],
      [CAPSULEDB_PACKAGE_ID, (version: string) => `@domainkit/capsuledb@${version}`],
    ] as const) {
      const pkg = this.graph.get(packageId);
      const packagePlan = plan.packages.get(packageId);
      if (pkg?.version === undefined || packagePlan === undefined) continue;

      packagePlan.git ??= {};
      packagePlan.git.tag = tag(pkg.version);
    }
  },
});

/**
 * Rewrites the workspace entries in `bun.lock` from each manifest after a version bump. Bun 1.2.8
 * through 1.4.0 skips that rewrite when only manifest versions change (oven-sh/bun#18906), so the
 * version PR would carry stale lock metadata. Delete this plugin once the repo runs a Bun that
 * includes oven-sh/bun#41302.
 */
const bunLockWorkspaceVersions = (): TegamiPlugin => ({
  name: "domainkit-bun-lock-workspace-versions",
  async applyCliDraft() {
    const lockPath = join(this.cwd, "bun.lock");
    const lines = (await readFile(lockPath, "utf8")).split("\n");
    const start = lines.indexOf('  "workspaces": {');
    if (start === -1) throw new Error("bun.lock has no workspaces section");

    let manifest: Record<string, unknown> | null = null;
    let ranges: Record<string, string> = {};
    let changed = false;
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line === "  },") break;
      const block = /^ {4}"([^"]*)": \{$/.exec(line);
      if (block) {
        const dir = block[1] ?? "";
        manifest = JSON.parse(readFileSync(join(this.cwd, dir, "package.json"), "utf8"));
        ranges = {};
        for (const field of [
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
        ]) {
          Object.assign(ranges, manifest?.[field] ?? {});
        }
        continue;
      }
      if (!manifest) continue;
      const version = /^ {6}"version": "([^"]*)",$/.exec(line);
      if (version) {
        const expected = manifest.version;
        if (typeof expected !== "string") {
          lines.splice(index, 1);
          index -= 1;
          changed = true;
        } else if (version[1] !== expected) {
          lines[index] = `      "version": "${expected}",`;
          changed = true;
        }
        continue;
      }
      const dep = /^( {8}"([^"]+)": ")(workspace:[^"]*)(",)$/.exec(line);
      if (dep) {
        const [, prefix = "", name = "", current = "", suffix = ""] = dep;
        const expected = ranges[name];
        if (typeof expected === "string" && expected !== current) {
          lines[index] = `${prefix}${expected}${suffix}`;
          changed = true;
        }
      }
    }
    if (changed) await writeFile(lockPath, lines.join("\n"));
  },
});

const paper = tegami({
  groups: {
    public: {
      syncBump: true,
    },
  },
  packages: {
    "@domainkit/capsuledb": { group: "public" },
    "@domainkit/react": { group: "public" },
    domainkit: { group: "public" },
  },
  npm: {
    client: "bun",
    onBreakPeerDep: "error",
    trustedPublish: {
      provider: "github",
      workflow: "publish.yml",
    },
    updateLockFile: true,
  },
  plugins: [
    bunLockWorkspaceVersions(),
    github({
      repo: REPOSITORY,
      pushTags: true,
      release: {
        create({ tag }) {
          return { title: tag };
        },
      },
      versionPr: {
        base: "main",
        branch: "tegami/version-packages",
        forceCreate: false,
        create() {
          return { title: "chore(release): prepare DomainKit" };
        },
      },
    }),
    releaseChecks(),
    versionTag(),
  ],
});

await runCli(paper);
