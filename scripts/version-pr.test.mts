import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, object } from "./release-metadata.mts";
import { parse } from "yaml";

const head = "a60c360c068366b51f49ff1a19aa51104fc7fc21";
const base = (await git(["rev-parse", `${head}^`])).trim();
const realGit = Bun.which("git");
if (!realGit) throw new Error("Git is required");
async function route(mode: string, options: { stale?: boolean; foreign?: boolean; closed?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "domainkit-version-route-"));
  try {
    const pr = {
      number: 165, state: options.closed ? "closed" : "open",
      user: { login: "github-actions[bot]", type: "Bot", id: 41898282 },
      base: { ref: "main", sha: base, repo: { full_name: "AryaLabsHQ/domainkit" } },
      head: { ref: "tegami/version-packages", sha: head, repo: { full_name: options.foreign ? "fork/domainkit" : "AryaLabsHQ/domainkit" } },
    };
    await writeFile(join(directory, "gh"), `#!${process.execPath}
const endpoint = process.argv[3];
const pr = ${JSON.stringify(pr)};
if (endpoint.includes("dispatches")) {
  await Bun.write(${JSON.stringify(join(directory, "dispatched"))}, JSON.stringify(process.argv.slice(2)));
} else if (endpoint.includes("git/ref")) console.log(JSON.stringify({ object: { sha: ${JSON.stringify(base)} } }));
else if (endpoint.includes("pulls?")) console.log(JSON.stringify([pr]));
else console.log(JSON.stringify(pr));
`);
    await writeFile(join(directory, "git"), `#!/bin/sh
if [ "$1" = fetch ]; then exit 0; fi
if [ "$1" = rev-parse ] && [ "$2" = FETCH_HEAD ]; then echo ${head}; exit 0; fi
exec ${JSON.stringify(realGit)} "$@"
`);
    await Promise.all([chmod(join(directory, "gh"), 0o755), chmod(join(directory, "git"), 0o755)]);
    const event = mode === "dispatch" ? {} : mode === "pull_request" ? { pull_request: pr } : {
      inputs: { pr: "165", head: options.stale ? "f".repeat(40) : head, base },
    };
    await writeFile(join(directory, "event"), JSON.stringify(event));
    const child = Bun.spawn([process.execPath, resolve("scripts/version-pr.mts"), mode === "dispatch" ? "dispatch" : "classify"], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_EVENT_NAME: mode,
        GITHUB_EVENT_PATH: join(directory, "event"), GITHUB_OUTPUT: join(directory, "output"), GITHUB_SHA: head },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const output = await Bun.file(join(directory, "output")).exists() ? await readFile(join(directory, "output"), "utf8") : "";
    const dispatched = await Bun.file(join(directory, "dispatched")).exists() ? await readFile(join(directory, "dispatched"), "utf8") : "";
    return { code, output, dispatched, stdout, stderr };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test("ordinary changes keep full CI, trusted native PRs take metadata validation", async () => {
  expect(await route("pull_request", { foreign: true })).toMatchObject({ code: 0, output: "metadata=false\n" });
  expect(await route("pull_request")).toMatchObject({ code: 0, output: "metadata=true\n" });
});
test("dispatch requires an open trusted PR and exact fresh event head", async () => {
  expect(await route("workflow_dispatch")).toMatchObject({ code: 0, output: "metadata=true\n" });
  const stale = await route("workflow_dispatch", { stale: true });
  expect(stale.code).toBe(1);
  expect(stale.output).toBe("");
  expect(stale.stderr).toContain("Event no longer matches");
  const closed = await route("dispatch", { closed: true });
  expect(closed.code).toBe(1);
  expect(closed.dispatched).toBe("");
});
test("dispatch submits only the current verified version ref and input SHAs", async () => {
  const result = await route("dispatch");
  expect(result.code).toBe(0);
  const args: unknown = JSON.parse(result.dispatched);
  expect(args).toEqual(["api", "repos/AryaLabsHQ/domainkit/actions/workflows/ci.yml/dispatches",
    "-f", "ref=tegami/version-packages", "-f", "inputs[pr]=165", "-f", `inputs[head]=${head}`, "-f", `inputs[base]=${base}`]);
});
test("required job names remain truthful and dispatch cannot access publication credentials", async () => {
  const ci = object(parse(await Bun.file(".github/workflows/ci.yml").text())), jobs = object(ci.jobs);
  for (const name of ["validate", "docs"]) {
    const job = object(jobs[name]);
    expect(job.needs).toBe("route");
    expect(job.if).toBe("always()");
    const steps = job.steps;
    if (!Array.isArray(steps)) throw new Error("Expected workflow steps");
    expect(object(steps[0]).run).toBe('test "$ROUTE_RESULT" = success');
    expect(object(steps[1]).if).toBe("needs.route.outputs.metadata == 'true'");
    for (const step of steps.slice(2)) expect(object(step).if).toBe("needs.route.outputs.metadata != 'true' && github.event_name != 'workflow_dispatch'");
  }
  const publishing = object(parse(await Bun.file(".github/workflows/publish.yml").text()));
  const publishJobs = object(publishing.jobs);
  expect(object(publishJobs["dispatch-version-checks"]).permissions).toEqual({ actions: "write", contents: "read", "pull-requests": "read" });
  expect(object(object(publishJobs.publish).permissions)["id-token"]).toBe("write");
  expect(object(object(publishJobs.publish).permissions).actions).toBeUndefined();
  const scripts = object(object(await Bun.file("package.json").json()).scripts);
  expect(scripts["release:publish"]).toBe("bun run tegami ci");
  expect(scripts["release:check"]).toBe("bun run check && bun run test:artifact && bun run docs:check");
  expect(await Bun.file("scripts/tegami.mts").text()).toContain("releaseChecks(),");
});
