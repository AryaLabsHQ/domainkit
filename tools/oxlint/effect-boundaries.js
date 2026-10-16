import path from "node:path";

const repoRoot = process.cwd();
const coreSource = "packages/domainkit/src/";

/** Files that may leave the Effect runtime: the transport's Promise edge and conformance's runner. */
const runtimeExitFiles = new Set([
  `${coreSource}Transport.ts`,
  `${coreSource}internal/conformance/storage.ts`,
]);

/** Declared foreign Promise boundaries: Web Crypto, fetch, oauth4webapi, and host async adapters. */
const foreignPromiseFiles = new Set([
  `${coreSource}Custody.ts`,
  `${coreSource}Storage.ts`,
  `${coreSource}Transport.ts`,
  `${coreSource}internal/digest.ts`,
  `${coreSource}internal/aes.ts`,
  `${coreSource}internal/doh.ts`,
  `${coreSource}internal/http.ts`,
  `${coreSource}internal/oauth.ts`,
  `${coreSource}internal/provider-async.ts`,
]);

/** @param {string} filename */
function relative(filename) {
  return path.relative(repoRoot, filename).replaceAll(path.sep, "/");
}

/**
 * @param {string} property
 * @param {Set<string>} allowed
 * @param {string} message
 * @returns {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]}
 */
function boundaryRule(property, allowed, message) {
  return {
    meta: {
      type: "problem",
      docs: { description: message },
    },
    create(context) {
      const filename = relative(context.filename);
      if (!filename.startsWith(coreSource)) return {};
      if (allowed.has(filename)) return {};
      return {
        CallExpression(node) {
          const member = node.callee;
          if (
            member.type === "MemberExpression" &&
            member.object.type === "Identifier" &&
            member.object.name === "Effect" &&
            ((member.property.type === "Identifier" && member.property.name === property) ||
              (member.computed &&
                member.property.type === "Literal" &&
                member.property.value === property))
          ) {
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
  "Effect.runPromise is not allowed inside the core package; hosts own the runtime.",
);

export const noForeignPromiseOutsideBoundary = boundaryRule(
  "tryPromise",
  foreignPromiseFiles,
  "Effect.tryPromise is only allowed at declared foreign Promise boundaries.",
);
