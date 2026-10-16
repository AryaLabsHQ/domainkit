import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git, object } from "./release-metadata.mts";
import { syncWorkspaceLock } from "./workspace-lock.mts";

export const historicalRelease = "a60c360c068366b51f49ff1a19aa51104fc7fc21";
export const historicalBase = (await git(["rev-parse", `${historicalRelease}^`])).trim();
const paths = (await git(["ls-tree", "-r", "--name-only", historicalBase]))
  .trim()
  .split("\n")
  .filter(
    (path) =>
      path === "package.json" ||
      path === "bun.lock" ||
      path.startsWith(".tegami/") ||
      /^(?:(?:apps|packages)\/[^/]+|examples)\/(?:package.json|CHANGELOG.md)$/.test(path),
  );
const workspacePaths = ["apps/docs", "packages/domainkit", "packages/react", "packages/capsuledb"];
const manifests = new Map(
  await Promise.all(
    workspacePaths.map(
      async (path) =>
        [
          path,
          object(JSON.parse(await git(["show", `${historicalRelease}:${path}/package.json`]))),
        ] as const,
    ),
  ),
);
// The real release contains stale ^0.20.0 lock ranges beside ^0.21.0 manifests. Correct only
// cached workspace metadata; preserve source, external resolutions, notes and every other field.
export const correctedLock = syncWorkspaceLock(
  await git(["show", `${historicalRelease}:bun.lock`]),
  manifests,
);
async function snapshot(ref: string, directory: string) {
  const existing = new Set((await git(["ls-tree", "-r", "--name-only", ref])).trim().split("\n"));
  await Promise.all(
    paths.map(async (path) => {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      if (existing.has(path)) await writeFile(target, await git(["show", `${ref}:${path}`]));
      else await rm(target, { force: true });
    }),
  );
}
/** Disposable Git fixture, never the repository's real index/config/hooks or an implementation worktree. */
export async function releaseFixture(edit: (cwd: string) => Promise<void> = async () => {}) {
  const cwd = await mkdtemp(join(tmpdir(), "domainkit-release-metadata-"));
  try {
    await git(["init", "-q"], cwd);
    await git(["config", "user.email", "fixture@example.invalid"], cwd);
    await git(["config", "user.name", "Fixture"], cwd);
    async function commit() {
      const files = (await git(["ls-files", "--cached", "--others", "--exclude-standard"], cwd))
        .trim()
        .split("\n");
      await git(["add", "--", ...new Set(files)], cwd);
      await git(["-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"], cwd);
      return (await git(["rev-parse", "HEAD"], cwd)).trim();
    }
    await snapshot(historicalBase, cwd);
    const base = await commit();
    await snapshot(historicalRelease, cwd);
    await writeFile(join(cwd, "bun.lock"), correctedLock);
    await edit(cwd);
    const head = await commit();
    return { cwd, base, head };
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}
