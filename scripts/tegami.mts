#!/usr/bin/env bun

import { tegami, type TegamiPlugin } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

import rootPackage from "../packages/domainkit/package.json" with { type: "json" };

const PACKAGE_ID = "npm:domainkit";
const REPOSITORY = "AryaLabsHQ/domainkit";

if (rootPackage.name !== "domainkit") throw new Error("Unexpected release package");

const releaseChecks = (): TegamiPlugin => ({
  name: "domainkit-release-checks",
  enforce: "pre",
  async afterPreflight({ plan }) {
    const packagePlan = plan.packages.get(PACKAGE_ID);
    if (packagePlan?.preflight?.shouldPublish !== true) return;

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
    const pkg = this.graph.get(PACKAGE_ID);
    const packagePlan = plan.packages.get(PACKAGE_ID);
    if (pkg?.version === undefined || packagePlan === undefined) return;

    packagePlan.git ??= {};
    packagePlan.git.tag = `v${pkg.version}`;
  },
});

const paper = tegami({
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
