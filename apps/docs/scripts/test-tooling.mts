import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browserOptions } from "./browser-options.mts";
import { registryManifest, shadcnCli } from "./registry-fixture.mts";

assert.deepEqual(browserOptions({}), {});
assert.deepEqual(browserOptions({ DOMAINKIT_BROWSER_CHANNEL: " chrome " }), { channel: "chrome" });
assert.deepEqual(browserOptions({ DOMAINKIT_BROWSER_EXECUTABLE_PATH: "/opt/browser/chromium" }), {
  launchOptions: { executablePath: "/opt/browser/chromium" },
});
assert.deepEqual(
  browserOptions({ DOMAINKIT_BROWSER_CHANNEL: " ", DOMAINKIT_BROWSER_EXECUTABLE_PATH: "" }),
  {},
);
assert.throws(
  () =>
    browserOptions({
      DOMAINKIT_BROWSER_CHANNEL: "chrome",
      DOMAINKIT_BROWSER_EXECUTABLE_PATH: "/opt/browser/chromium",
    }),
  /Set only one/,
);

const manifest = registryManifest("/tmp/branch-core.tgz", "/tmp/branch-react.tgz");
assert.equal(manifest.dependencies.domainkit, "file:/tmp/branch-core.tgz");
assert.equal(manifest.dependencies["@domainkit/react"], "file:/tmp/branch-react.tgz");
assert.deepEqual(manifest.overrides, manifest.dependencies);
for (const [name, version] of Object.entries(manifest.dependencies)) {
  if (name === "domainkit" || name === "@domainkit/react") continue;
  assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `${name} must name an exact version`);
}

// A fresh directory has no node_modules or CLI on its own. It must still run the workspace's
// locked shadcn, without bunx resolving an unrelated version from the package registry.
const fixture = await mkdtemp(join(tmpdir(), "domainkit-tooling-"));
try {
  const child = Bun.spawn(["node", shadcnCli, "--version"], {
    cwd: fixture,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exitCode, 0, stderr);
  const docs = await Bun.file(new URL("../package.json", import.meta.url)).json();
  assert.equal(stdout.trim(), docs.devDependencies.shadcn);
} finally {
  await rm(fixture, { force: true, recursive: true });
}

console.log("Browser selection and registry tooling use explicit, pinned inputs.");
