import { resolve } from "node:path";

interface EntryPoint {
  readonly label: string;
  readonly source: string;
  readonly reference: string;
}

const root = resolve(import.meta.dir, "../../..");
const entryPoints: ReadonlyArray<EntryPoint> = [
  {
    label: "domainkit",
    source: "packages/domainkit/src/index.ts",
    reference: "apps/docs/content/reference/core.mdx",
  },
  {
    label: "domainkit/promise",
    source: "packages/domainkit/src/promise.ts",
    reference: "apps/docs/content/reference/promise.mdx",
  },
  {
    label: "domainkit/testing",
    source: "packages/domainkit/src/testing.ts",
    reference: "apps/docs/content/reference/testing.mdx",
  },
  {
    label: "@domainkit/react",
    source: "packages/react/src/index.ts",
    reference: "apps/docs/content/reference/react.mdx",
  },
];

const exportedNames = (source: string): ReadonlyArray<string> => {
  const namespaces = [...source.matchAll(/export\s+(?:type\s+)?\*\s+as\s+(\w+)/g)].map(
    ([, name]) => name,
  );
  const constants = [...source.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*)/g)].map(
    ([, name]) => name,
  );
  return [...new Set([...constants, ...namespaces])].sort();
};

const failures = (
  await Promise.all(
    entryPoints.map(async (entryPoint) => {
      const [source, reference] = await Promise.all([
        Bun.file(resolve(root, entryPoint.source)).text(),
        Bun.file(resolve(root, entryPoint.reference)).text(),
      ]);
      const missing = exportedNames(source).filter((name) => !reference.includes(`\`${name}\``));
      return missing.length === 0 ? [] : [`${entryPoint.label}: ${missing.join(", ")}`];
    }),
  )
).flat();

if (failures.length > 0) {
  console.error("Public exports missing from their reference page:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Reference coverage is current for ${entryPoints.length} public entry points.`);
