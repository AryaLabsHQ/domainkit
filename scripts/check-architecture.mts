const canonicalWorkflowFiles = [
  "src/auth/oauth.ts",
  "src/auth/token.ts",
  "src/plan/connection-authorization.ts",
  "src/plan/plan.ts",
  "src/verification/verify.ts",
] as const;

const violations: Array<string> = [];

for (const path of canonicalWorkflowFiles) {
  const source = await Bun.file(path).text();
  if (/\bexport\s+async\b/.test(source)) {
    violations.push(`${path}: canonical workflow exports an async function`);
  }
  if (source.includes("Effect.runPromise")) {
    violations.push(`${path}: canonical workflow exits through Effect.runPromise`);
  }
}

const effectEntry = await Bun.file("src/effect.ts").text();
if (effectEntry.includes('from "./promise.ts"')) {
  violations.push("src/effect.ts: Effect entry imports the Promise facade");
}
if (/export\s+\*\s+from/.test(effectEntry)) {
  violations.push("src/effect.ts: Effect entry uses an uncurated wildcard export");
}
if (/Effect\.(?:tryPromise|runPromise)/.test(effectEntry)) {
  violations.push("src/effect.ts: Effect entry contains a Promise bridge");
}

const promiseFacade = await Bun.file("src/promise.ts").text();
if (!promiseFacade.includes("Effect.runPromise")) {
  violations.push("src/promise.ts: Promise facade does not execute canonical Effects");
}

const canonicalTryPromise = canonicalWorkflowFiles.flatMap(async (path) => {
  const source = await Bun.file(path).text();
  return path === "src/auth/oauth.ts"
    ? []
    : source.includes("Effect.tryPromise")
      ? [`${path}: canonical workflow lifts a Promise internally`]
      : [];
});
violations.push(...(await Promise.all(canonicalTryPromise)).flat());

const oauthSource = await Bun.file("src/auth/oauth.ts").text();
const oauthPromiseBoundaries = oauthSource.match(/Effect\.tryPromise/g)?.length ?? 0;
if (oauthPromiseBoundaries !== 1) {
  violations.push(
    `src/auth/oauth.ts: expected one oauth4webapi Promise boundary, found ${oauthPromiseBoundaries}`,
  );
}

if (violations.length > 0) {
  throw new Error(
    `Architecture check failed:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
}

console.log("Architecture check passed: Effect owns workflows and Promise exits stay at bridges.");
