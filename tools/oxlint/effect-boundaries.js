import path from "node:path";

const repoRoot = process.cwd();

const runtimeExitFiles = new Set([
  "src/provider/provider.ts",
  "src/verification/resolver.ts",
  "src/stores/connection.ts",
  "src/stores/credential.ts",
  "src/stores/oauth-state.ts",
  "src/stores/receipt.ts",
]);

const foreignPromiseFiles = new Set([
  "src/auth/oauth.ts",
  "src/plan/canonical-json.ts",
  "src/provider/provider.ts",
  "src/providers/cloudflare/client.ts",
  "src/providers/vercel/auth.ts",
  "src/providers/vercel/client.ts",
  "src/promise/oauth.ts",
  "src/promise/token.ts",
  "src/stores/connection.ts",
  "src/stores/credential.ts",
  "src/stores/oauth-state.ts",
  "src/stores/receipt.ts",
  "src/verification/doh.ts",
  "src/verification/resolver.ts",
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
      if (!filename.startsWith("src/")) return {};
      if (filename.startsWith("src/promise/") && property === "runPromise") return {};
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
