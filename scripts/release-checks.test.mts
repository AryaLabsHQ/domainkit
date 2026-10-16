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
    let publicationReached = false;
    const publicationSubstitute: TegamiPlugin = {
      name: "local-publication-substitute",
      enforce: "pre",
      publishPreflight() {
        return { shouldPublish: true };
      },
      beforePublishAll() {
        publicationReached = true;
        throw new Error("Local publication reached");
      },
    };
    try {
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
      const paper = tegami({ cwd, plugins: [releaseChecks(), publicationSubstitute] });
      await assert.rejects(
        paper.publish(),
        exitCode ? /DomainKit release gate failed/ : /Local publication reached/,
      );
      assert.equal(publicationReached, exitCode === 0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
