import { access, cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const capsuleDbSha = "c323a6c6657d095fa58541985341ea68036b33f7";
const workspaceRoot = resolve(import.meta.dir, "..");
const integrationRoot = join(workspaceRoot, "packages", "capsuledb");
const installedRoot = join(integrationRoot, "node_modules", "capsuledb");
const output = join(installedRoot, "dist");

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const lockfile = await readFile(join(workspaceRoot, "bun.lock"), "utf8");
if (!lockfile.includes(capsuleDbSha)) {
  throw new Error(`bun.lock does not pin CapsuleDB at ${capsuleDbSha}`);
}

const installedPackage = JSON.parse(
  await readFile(join(installedRoot, "package.json"), "utf8"),
) as { readonly name?: string };
if (installedPackage.name !== "capsuledb") {
  throw new Error("The installed CapsuleDB dependency has an unexpected package name");
}

const installedRealPath = await realpath(installedRoot);
if (!installedRealPath.includes(`CapsuleDB+${capsuleDbSha.slice(0, 7)}`)) {
  throw new Error("The installed CapsuleDB dependency does not match the locked Git revision");
}

if ((await exists(join(output, "index.mjs"))) && (await exists(join(output, "index.d.mts")))) {
  process.exit(0);
}

const temporaryRoot = await mkdtemp(join(integrationRoot, ".capsuledb-git-build-"));
try {
  await Promise.all([
    cp(join(installedRoot, "src"), join(temporaryRoot, "src"), { recursive: true }),
    cp(join(installedRoot, "package.json"), join(temporaryRoot, "package.json")),
    cp(join(installedRoot, "tsconfig.json"), join(temporaryRoot, "tsconfig.json")),
    cp(join(installedRoot, "tsdown.config.ts"), join(temporaryRoot, "tsdown.config.ts")),
  ]);

  const build = Bun.spawn(
    [join(integrationRoot, "node_modules", ".bin", "tsdown"), "--config", "tsdown.config.ts"],
    {
      cwd: temporaryRoot,
      stderr: "inherit",
      stdout: "inherit",
    },
  );
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    throw new Error(`CapsuleDB Git dependency build failed with exit code ${exitCode}`);
  }

  await rm(output, { force: true, recursive: true });
  await cp(join(temporaryRoot, "dist"), output, { recursive: true });
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
