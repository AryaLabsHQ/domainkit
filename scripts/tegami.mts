#!/usr/bin/env bun

import { tegami, type TegamiPlugin } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";
import path from "node:path";
import { releaseChecks } from "./release-gate.mts";
import { syncWorkspaceLock } from "./workspace-lock.mts";
import { object } from "./release-metadata.mts";

import rootPackage from "../packages/domainkit/package.json" with { type: "json" };

const CORE_PACKAGE_ID = "npm:domainkit";
const REACT_PACKAGE_ID = "npm:@domainkit/react";
const CAPSULEDB_PACKAGE_ID = "npm:@domainkit/capsuledb";
const REPOSITORY = "AryaLabsHQ/domainkit";

if (rootPackage.name !== "domainkit") throw new Error("Unexpected release package");

/** Refresh resolutions, then synchronize cached workspace metadata before Tegami commits it. */
const lockfileSync = (): TegamiPlugin => ({
  name: "domainkit-lockfile-sync",
  enforce: "pre",
  async applyCliDraft() {
    const install = Bun.spawn(["bun", "install", "--lockfile-only"], {
      cwd: this.cwd,
      stderr: "inherit",
      stdout: "inherit",
    });
    if ((await install.exited) !== 0) throw new Error("bun.lock refresh failed");

    const manifests = new Map(await Promise.all(this.graph.getPackages().map(async (pkg) => {
      const workspace = path.relative(this.cwd, pkg.path).split(path.sep).join("/");
      const manifest: unknown = await Bun.file(path.join(pkg.path, "package.json")).json();
      return [workspace, object(manifest)] as const;
    })));
    const file = Bun.file(path.join(this.cwd, "bun.lock"));
    await Bun.write(file, syncWorkspaceLock(await file.text(), manifests));
    console.log("bun.lock carries current workspace versions and dependency ranges");
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
    lockfileSync(),
    releaseChecks(),
    versionTag(),
  ],
});

await runCli(paper);
