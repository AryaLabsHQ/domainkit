const requiredFiles = new Set([
  "LICENSE",
  "README.md",
  "dist/effect.d.mts",
  "dist/effect.mjs",
  "dist/index.d.mts",
  "dist/index.mjs",
  "dist/testing.d.mts",
  "dist/testing.mjs",
  "package.json",
]);
const generatedArtifact = /^dist\/[a-zA-Z0-9_-]+\.(?:mjs|d\.mts)(?:\.map)?$/;

const forbiddenPatterns = [
  /(?:^|\/)\.env(?:\.|$)/,
  /(?:^|\/)\.scratchpad(?:\/|$)/,
  /(?:^|\/)src(?:\/|$)/,
  /(?:^|\/)tests?(?:\/|$)/,
  /(?:^|\/).*\.(?:pem|key|tgz)$/,
];

const process = Bun.spawn(["npm", "pack", "--dry-run", "--json"], {
  stderr: "inherit",
  stdout: "pipe",
});
const output = await new Response(process.stdout).text();
const exitCode = await process.exited;

if (exitCode !== 0) {
  throw new Error(`npm pack --dry-run failed with exit code ${exitCode}`);
}

const packages = JSON.parse(output) as ReadonlyArray<{
  readonly files: ReadonlyArray<{ readonly path: string }>;
}>;
const files = packages[0]?.files.map(({ path }) => path).sort();

if (files === undefined) {
  throw new Error("npm pack did not return a package manifest");
}

const unexpected = files.filter(
  (path) =>
    (!requiredFiles.has(path) && !generatedArtifact.test(path)) ||
    forbiddenPatterns.some((pattern) => pattern.test(path)),
);
const missing = [...requiredFiles].filter((path) => !files.includes(path));

if (unexpected.length > 0 || missing.length > 0) {
  throw new Error(
    `Package contents differ from the allowlist. Unexpected: ${unexpected.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}.`,
  );
}

console.log(`Package audit passed (${files.length} files).`);
