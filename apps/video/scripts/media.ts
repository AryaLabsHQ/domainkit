import { dirname, join } from "node:path";

/** Git's common directory keeps paid media outside disposable worktrees. */
export function musicFile(track: string): string {
  const common = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: import.meta.dir,
  });
  if (!common.success) throw new Error(`git common directory: ${common.stderr.toString().trim()}`);
  return join(
    dirname(common.stdout.toString().trim()),
    "apps/video/media/introducing-domainkit/music",
    track,
  );
}
