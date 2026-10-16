import type { TegamiPlugin } from "tegami";

const packageIds = ["npm:domainkit", "npm:@domainkit/react", "npm:@domainkit/capsuledb"];

/** Preflight eligibility is not a remote publication-status check; this hook can run repeatedly. */
export const releaseChecks = (): TegamiPlugin => ({
  name: "domainkit-release-checks",
  enforce: "pre",
  async afterPreflight({ plan }) {
    if (!packageIds.some((id) => plan.packages.get(id)?.preflight?.shouldPublish === true)) return;
    const child = Bun.spawn(["bun", "run", "release:check"], {
      cwd: this.cwd,
      stderr: "inherit",
      stdout: "inherit",
    });
    if ((await child.exited) !== 0) throw new Error("DomainKit release gate failed");
  },
});
