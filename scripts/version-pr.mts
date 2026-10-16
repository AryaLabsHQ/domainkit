import { appendFile } from "node:fs/promises";
import { classifyMetadata, git, object } from "./release-metadata.mts";

const repository = "AryaLabsHQ/domainkit";
const branch = "tegami/version-packages";

async function github(endpoint: string, fields: Record<string, string> = {}): Promise<unknown> {
  const child = Bun.spawn(
    [
      "gh",
      "api",
      endpoint,
      ...Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`]),
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`GitHub request failed: ${endpoint}`);
  return output.trim() ? JSON.parse(output) : null;
}
export function trustedVersionPr(value: unknown, currentBase: string) {
  const pr = object(value),
    user = object(pr.user),
    base = object(pr.base),
    head = object(pr.head);
  return (
    pr.state === "open" &&
    user.login === "github-actions[bot]" &&
    user.type === "Bot" &&
    user.id === 41898282 &&
    object(base.repo).full_name === repository &&
    object(head.repo).full_name === repository &&
    base.ref === "main" &&
    base.sha === currentBase &&
    head.ref === branch &&
    typeof head.sha === "string" &&
    /^[a-f0-9]{40}$/.test(head.sha)
  );
}
async function currentPr(number: number) {
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Invalid PR number");
  const [pr, base] = await Promise.all([
    github(`repos/${repository}/pulls/${number}`),
    github(`repos/${repository}/git/ref/heads/main`),
  ]);
  const currentBase = object(object(base).object).sha;
  if (typeof currentBase !== "string" || !trustedVersionPr(pr, currentBase))
    throw new Error("Not a current trusted version PR");
  return { pr: object(pr), base: currentBase, head: String(object(object(pr).head).sha) };
}
async function inspect(number: number) {
  const state = await currentPr(number);
  await git(["fetch", "--no-tags", "origin", branch]);
  if ((await git(["rev-parse", "FETCH_HEAD"])).trim() !== state.head)
    throw new Error("Version branch moved during fetch");
  const result = await classifyMetadata(state.base, state.head);
  const fresh = await currentPr(number);
  if (fresh.base !== state.base || fresh.head !== state.head)
    throw new Error("Version PR moved during validation");
  return { ...state, ...result };
}
async function main() {
  const mode = process.argv[2];
  if (mode === "dispatch") {
    const values = await github(
      `repos/${repository}/pulls?state=open&head=AryaLabsHQ:${branch}&base=main`,
    );
    if (!Array.isArray(values)) throw new Error("Invalid PR list");
    if (values.length === 0) {
      console.log("No open version PR");
      return;
    }
    if (values.length !== 1) throw new Error("Ambiguous version PR");
    const state = await inspect(Number(object(values[0]).number));
    if (!state.metadataOnly) throw new Error(`Version PR needs normal CI: ${state.reason}`);
    await github(`repos/${repository}/actions/workflows/ci.yml/dispatches`, {
      ref: branch,
      "inputs[pr]": String(state.pr.number),
      "inputs[head]": state.head,
      "inputs[base]": state.base,
    });
    console.log(
      `Dispatched metadata validation for ${state.head}; ruleset attachment remains provisional. Use manual approval/rerun if checks do not attach.`,
    );
    return;
  }
  if (mode !== "classify") throw new Error("Expected classify or dispatch");
  const event: unknown = await Bun.file(process.env.GITHUB_EVENT_PATH ?? "").json();
  const payload = object(event),
    dispatched = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
  let result = { metadataOnly: false, reason: "Ordinary change: run full CI" };
  try {
    const inputs = dispatched ? object(payload.inputs) : object(payload.pull_request);
    const state = await inspect(Number(dispatched ? inputs.pr : inputs.number));
    const expectedHead = dispatched ? inputs.head : object(inputs.head).sha;
    const expectedBase = dispatched ? inputs.base : object(inputs.base).sha;
    if (
      state.head !== expectedHead ||
      state.base !== expectedBase ||
      (dispatched && process.env.GITHUB_SHA !== state.head)
    )
      throw new Error("Event no longer matches current base/head");
    result = state;
  } catch (error) {
    if (dispatched) throw error;
    console.log(error instanceof Error ? error.message : error);
  }
  if (dispatched && !result.metadataOnly) throw new Error(`Dispatch rejected: ${result.reason}`);
  console.log(result.reason);
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  await appendFile(output, `metadata=${result.metadataOnly}\n`);
}
if (import.meta.main) await main();
