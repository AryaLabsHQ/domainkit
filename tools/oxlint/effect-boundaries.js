import path from "node:path";

const repoRoot = process.cwd();
const coreSource = "packages/domainkit/src/";

const runtimeExitFiles = new Set([
  `${coreSource}provider/provider.ts`,
  `${coreSource}provider/session.ts`,
  `${coreSource}verification/resolver.ts`,
  `${coreSource}stores/connection.ts`,
  `${coreSource}stores/authorization.ts`,
  `${coreSource}stores/credential.ts`,
  `${coreSource}stores/oauth-state.ts`,
  `${coreSource}stores/receipt.ts`,
  `${coreSource}transport.ts`,
]);

const foreignPromiseFiles = new Set([
  `${coreSource}auth/authorization-code.ts`,
  `${coreSource}plan/canonical-json.ts`,
  `${coreSource}provider/provider.ts`,
  `${coreSource}provider/session.ts`,
  `${coreSource}server/index.ts`,
  `${coreSource}providers/cloudflare/client.ts`,
  `${coreSource}providers/cloudflare/auth.ts`,
  `${coreSource}providers/vercel/auth.ts`,
  `${coreSource}providers/vercel/client.ts`,
  `${coreSource}promise/connection-lifecycle.ts`,
  `${coreSource}promise/token.ts`,
  `${coreSource}stores/connection.ts`,
  `${coreSource}stores/authorization.ts`,
  `${coreSource}stores/credential.ts`,
  `${coreSource}stores/oauth-state.ts`,
  `${coreSource}stores/receipt.ts`,
  `${coreSource}transport.ts`,
  `${coreSource}verification/doh.ts`,
  `${coreSource}verification/resolver.ts`,
]);

function relative(filename) {
  return path.relative(repoRoot, filename).replaceAll(path.sep, "/");
}

function effectMember(node, property) {
  if (node?.type !== "MemberExpression") return false;
  return (
    node.object?.type === "Identifier" &&
    node.object.name === "Effect" &&
    ((node.property?.type === "Identifier" && node.property.name === property) ||
      (node.computed && node.property?.type === "Literal" && node.property.value === property))
  );
}

function boundaryRule(property, allowed, message) {
  return {
    meta: {
      type: "problem",
      docs: { description: message },
    },
    create(context) {
      const filename = relative(context.filename);
      if (!filename.startsWith(coreSource)) return {};
      if (filename.startsWith(`${coreSource}promise/`) && property === "runPromise") return {};
      if (filename.startsWith(`${coreSource}promise/`) && property === "tryPromise") return {};
      if (allowed.has(filename)) return {};
      return {
        CallExpression(node) {
          if (effectMember(node.callee, property)) {
            context.report({ node: node.callee, message });
          }
        },
      };
    },
  };
}

export const noRuntimeExit = boundaryRule(
  "runPromise",
  runtimeExitFiles,
  "Effect.runPromise is only allowed in the Promise facade and explicit Effect-to-Promise bridges.",
);

export const noForeignPromiseOutsideBoundary = boundaryRule(
  "tryPromise",
  foreignPromiseFiles,
  "Effect.tryPromise is only allowed at declared foreign Promise boundaries.",
);
