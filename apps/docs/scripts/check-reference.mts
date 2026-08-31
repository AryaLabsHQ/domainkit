import { resolve } from "node:path";

interface EntryPoint {
  readonly inventoryColumn: number;
  readonly label: string;
  readonly source: string;
  readonly reference: string;
}

const root = resolve(import.meta.dir, "../../..");
const entryPoints: ReadonlyArray<EntryPoint> = [
  {
    inventoryColumn: 1,
    label: "domainkit",
    source: "packages/domainkit/src/index.ts",
    reference: "apps/docs/content/reference/core.mdx",
  },
  {
    inventoryColumn: 2,
    label: "domainkit/promise",
    source: "packages/domainkit/src/promise.ts",
    reference: "apps/docs/content/reference/promise.mdx",
  },
  {
    inventoryColumn: 1,
    label: "domainkit/server",
    source: "packages/domainkit/src/server.ts",
    reference: "apps/docs/content/reference/server.mdx",
  },
  {
    inventoryColumn: 1,
    label: "domainkit/testing",
    source: "packages/domainkit/src/testing.ts",
    reference: "apps/docs/content/reference/testing.mdx",
  },
  {
    inventoryColumn: 1,
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

const documentedNames = (
  reference: string,
  path: string,
  inventoryColumn: number,
): ReadonlySet<string> => {
  const inventory = reference.match(
    /\{\/\* reference-inventory:start \*\/\}([\s\S]*?)\{\/\* reference-inventory:end \*\/\}/,
  )?.[1];
  if (inventory === undefined) {
    throw new Error(`Missing reference inventory markers in ${path}`);
  }
  return new Set(
    inventory
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .flatMap((line) => [line.split("|")[inventoryColumn] ?? ""])
      .flatMap((cell) => [...cell.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)].map(([, name]) => name)),
  );
};

const failures = (
  await Promise.all(
    entryPoints.map(async (entryPoint) => {
      const [source, reference] = await Promise.all([
        Bun.file(resolve(root, entryPoint.source)).text(),
        Bun.file(resolve(root, entryPoint.reference)).text(),
      ]);
      const exports = exportedNames(source);
      const inventory = documentedNames(
        reference,
        entryPoint.reference,
        entryPoint.inventoryColumn,
      );
      const missing = exports.filter((name) => !inventory.has(name));
      const exported = new Set(exports);
      const stale = [...inventory].filter((name) => !exported.has(name));
      return [
        ...(missing.length === 0
          ? []
          : [`${entryPoint.label} missing references: ${missing.join(", ")}`]),
        ...(stale.length === 0
          ? []
          : [`${entryPoint.label} stale references: ${stale.join(", ")}`]),
      ];
    }),
  )
).flat();

if (failures.length > 0) {
  console.error("Public exports missing from their reference page:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Reference coverage is current for ${entryPoints.length} public entry points.`);
