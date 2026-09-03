#!/usr/bin/env bun

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
    releaseChecks(),
    versionTag(),
  ],
});

await runCli(paper);
