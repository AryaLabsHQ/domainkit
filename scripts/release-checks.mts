import type { TegamiPlugin } from "tegami";

export const releaseChecks = (): TegamiPlugin => ({
  name: "domainkit-release-checks",
  enforce: "pre",
  async afterPreflight({ plan }) {
    const shouldPublish = [
      "npm:domainkit",
      "npm:@domainkit/react",
      "npm:@domainkit/capsuledb",
    ].some((packageId) => plan.packages.get(packageId)?.preflight?.shouldPublish === true);
    if (!shouldPublish) return;

    const child = Bun.spawn(["bun", "run", "release:check"], {
      cwd: this.cwd,
      stderr: "inherit",
      stdout: "inherit",
    });
    if ((await child.exited) !== 0) throw new Error("DomainKit release gate failed");
  },
});
