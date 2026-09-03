import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

/**
 * Every code sample on the site is a slice of a file that typechecks in CI: the gallery under
 * `examples/` (root `typecheck:examples`) and the core package's own executable examples
 * (`domainkit release:check`). Nothing here is hand-written prose pretending to be code.
 */
const allowedRoots = ["examples/", "packages/domainkit/examples/"];

/**
 * Walk up from the working directory to the workspace root. `import.meta.url` points into the
 * bundle during a production build, so it cannot locate the source trees.
 */
const findRepositoryRoot = (): string => {
  let directory = resolve(process.cwd());
  for (;;) {
    if (allowedRoots.every((root) => existsSync(join(directory, root)))) return directory;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`No workspace root above ${process.cwd()} holds the example trees`);
    }
    directory = parent;
  }
};

const repositoryRoot = findRepositoryRoot();

const languages: Readonly<Record<string, string>> = {
  ".css": "css",
  ".json": "json",
  ".sh": "sh",
  ".ts": "ts",
  ".tsx": "tsx",
};

export const languageOf = (file: string): string => languages[extname(file)] ?? "txt";

const read = (file: string): string => {
  if (file.includes("..") || !allowedRoots.some((root) => file.startsWith(root))) {
    throw new Error(`Snippet ${file} is outside the typechecked example trees`);
  }
  return readFileSync(join(repositoryRoot, file), "utf8");
};

const dedent = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const shortest = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(shortest));
};

const trimBlankEdges = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(start, end);
};

/** A line-comment marker in TypeScript, the same marker inside a block comment in CSS. */
const MARKER = /^(?:\/\/|\/\*)\s*#(region|endregion)(?:\s+([\w-]+))?\s*(?:\*\/)?$/;

export interface Marker {
  readonly kind: "endregion" | "region";
  readonly name: string | null;
}

/**
 * The marker a line is, or `null` when it is ordinary code. Names match whole: a region called
 * `plan` is never found by a line that opens `planning`.
 */
export const markerOf = (line: string): Marker | null => {
  const match = MARKER.exec(line.trim());
  if (match === null) return null;
  return { kind: match[1] as Marker["kind"], name: match[2] ?? null };
};

/** A `// #region name` … `// #endregion` slice, or the whole file when no region is named. */
export const snippet = (file: string, region?: string): string => {
  const lines = read(file).split("\n");
  if (region === undefined) {
    return trimBlankEdges(lines.filter((line) => markerOf(line) === null)).join("\n");
  }
  const start = lines.findIndex((line) => {
    const marker = markerOf(line);
    return marker?.kind === "region" && marker.name === region;
  });
  if (start < 0) throw new Error(`Snippet ${file} has no region ${region}`);
  const end = lines.findIndex(
    (line, index) => index > start && markerOf(line)?.kind === "endregion",
  );
  if (end < 0) throw new Error(`Snippet ${file} never closes region ${region}`);
  return trimBlankEdges(dedent(lines.slice(start + 1, end))).join("\n");
};
