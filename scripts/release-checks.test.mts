import { spyOn } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { tegami, type TegamiPlugin } from "tegami";

import { releaseChecks } from "./release-checks.mts";

for (const exitCode of [1, 0]) {
  test(`release:check exit ${exitCode} ${exitCode ? "blocks" : "reaches"} publication`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "domainkit-release-gate-"));
    const userConfig = process.env.NPM_CONFIG_USERCONFIG;
    const rejectNetwork = () => {
      throw new Error("Release gate fixture attempted an outbound fetch");
    };
    const fetchTrap = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(rejectNetwork, { preconnect: rejectNetwork }),
    );
    let publicationReached = false;
    const publicationSubstitute: TegamiPlugin = {
      name: "local-publication-substitute",
      enforce: "pre",
      publishPreflight() {
        return { shouldPublish: true };
      },
      resolvePlanStatus() {
        return "pending";
      },
      beforePublishAll() {
        publicationReached = true;
        throw new Error("Local publication reached");
      },
    };
    try {
      // Graph resolution reads npm user configuration even when publication is substituted.
      process.env.NPM_CONFIG_USERCONFIG = join(cwd, ".npmrc");
      await writeFile(process.env.NPM_CONFIG_USERCONFIG, "");
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({
          name: "domainkit",
          version: "1.0.0",
          scripts: { "release:check": `bun -e 'process.exit(${exitCode})'` },
        }),
      );
      await mkdir(join(cwd, ".tegami"));
      await writeFile(
        join(cwd, ".tegami/publish-lock.yaml"),
        "core:packages:\n  - id: npm:domainkit\n    updated: true\nnpm:packages:\n  - id: npm:domainkit\n",
      );
      const paper = tegami({
        cwd,
        npm: { client: "bun" },
        plugins: [releaseChecks(), publicationSubstitute],
      });
      const context = await paper._internal.context();
      assert.ok(context.graph.get("npm:domainkit"));
      // Keep the resolved graph and lifecycle; replace npm's remote task/status behavior.
      context.plugins = context.plugins.filter((plugin) => plugin.name !== "npm");
      await assert.rejects(
        paper.publish(),
        exitCode ? /DomainKit release gate failed/ : /Local publication reached/,
      );
      assert.equal(publicationReached, exitCode === 0);
      assert.equal(fetchTrap.mock.calls.length, 0);
    } finally {
      fetchTrap.mockRestore();
      if (userConfig === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
      else process.env.NPM_CONFIG_USERCONFIG = userConfig;
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
