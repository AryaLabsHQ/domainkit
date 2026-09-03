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
    label: "domainkit/server",
    source: "packages/domainkit/src/entry/server.ts",
    reference: "apps/docs/content/reference/server.mdx",
  },
  {
    label: "domainkit/client",
    source: "packages/domainkit/src/entry/client.ts",
    reference: "apps/docs/content/reference/transport.mdx",
  },
  {
    label: "domainkit/testing",
    source: "packages/domainkit/src/entry/testing.ts",
    reference: "apps/docs/content/reference/testing.mdx",
  },
  {
    label: "@domainkit/react",
    source: "packages/react/src/index.ts",
    reference: "apps/docs/content/reference/react.mdx",
  },
  {
    label: "@domainkit/capsuledb",
    source: "packages/capsuledb/src/index.ts",
    reference: "apps/docs/content/reference/capsuledb.mdx",
  },
];

const exportedNames = (source: string): ReadonlyArray<string> => {
  const namespaces = [...source.matchAll(/export\s+(?:type\s+)?\*\s+as\s+(\w+)/g)].map(
    ([, name]) => name,
  );
  const constants = [...source.matchAll(/export\s+const\s+([A-Za-z][A-Za-z0-9_]*)/g)].map(
    ([, name]) => name,
  );
  const named = [...source.matchAll(/export\s*\{([\s\S]*?)\}/g)].flatMap(([, block]) =>
    block.split(",").flatMap((entry) => {
      const match = entry
        .trim()
        .match(/^(?:type\s+)?([A-Za-z][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z][A-Za-z0-9_]*))?$/);
      if (match === null) return [];
      const name = match[2] ?? match[1];
      return name === undefined ? [] : [name];
    }),
  );
  return [...new Set([...constants, ...namespaces, ...named])].sort();
};

/** The first column of every table row between the inventory markers. */
const documentedNames = (reference: string, path: string): ReadonlySet<string> => {
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
      .flatMap((line) => [line.split("|")[1] ?? ""])
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
      const inventory = documentedNames(reference, entryPoint.reference);
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
