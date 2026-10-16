import { isDeepStrictEqual } from "node:util";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { gt, satisfies, valid } from "semver";
import { parse as parseYaml } from "yaml";

const publicPackages = new Set(["domainkit", "@domainkit/react", "@domainkit/capsuledb"]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error("Expected an object");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string");
  return value;
}
function json(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error("Invalid JSON/lockfile");
  return object(value);
}
function equal(actual: unknown, expected: unknown, label: string) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`Unexpected change: ${label}`);
}
export async function git(args: string[], cwd = process.cwd()): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${stderr}`);
  return stdout;
}

/** Validate a Git diff without executing anything from its candidate tree. */
export async function classifyMetadata(base: string, head: string, cwd = process.cwd()) {
  try {
    if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
      throw new Error("Expected full SHAs");
    const read = (ref: string, path: string) => git(["show", `${ref}:${path}`], cwd);
    if ((await git(["merge-base", base, head], cwd)).trim() !== base)
      throw new Error("Version branch must contain the current base");
    const paths = (await git(["ls-tree", "-r", "--name-only", base], cwd))
      .trim()
      .split("\n")
      .filter((path) => /^(?:(?:apps|packages)\/[^/]+|examples)\/package\.json$/.test(path));
    const manifests = new Map<
      string,
      { before: Record<string, unknown>; after: Record<string, unknown>; path: string }
    >();
    await Promise.all(
      ["package.json", ...paths].map(async (path) => {
        const [oldText, newText] = await Promise.all([read(base, path), read(head, path)]);
        const before = json(oldText),
          after = json(newText);
        manifests.set(string(before.name), { before, after, path });
      }),
    );
    const bumped = new Map<string, string>();
    for (const [name, { before, after }] of manifests) {
      if (before.version === after.version) continue;
      const from = string(before.version),
        to = string(after.version);
      if (!publicPackages.has(name) || !valid(from) || !valid(to) || !gt(to, from))
        throw new Error(`Invalid version bump: ${name}`);
      bumped.set(name, to);
    }
    if (bumped.size !== publicPackages.size || new Set(bumped.values()).size !== 1)
      throw new Error("Expected a synchronized public release group");
    for (const [name, { before, after }] of manifests) {
      const expected = structuredClone(before);
      if (bumped.has(name)) expected.version = bumped.get(name);
      for (const field of dependencyFields) {
        if (isDeepStrictEqual(before[field], after[field])) continue;
        const oldDeps = object(before[field]),
          newDeps = object(after[field]);
        const expectedDeps = { ...oldDeps };
        for (const dep of Object.keys(newDeps)) {
          if (oldDeps[dep] === newDeps[dep]) continue;
          const old = string(oldDeps[dep]),
            next = string(newDeps[dep]);
          const target = manifests.get(dep),
            version = bumped.get(dep);
          const match = /^workspace:([~^]?)(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.exec(old);
          if (
            !target ||
            !version ||
            !match ||
            !satisfies(string(target.before.version), old.slice("workspace:".length)) ||
            next !== `workspace:${match[1]}${version}`
          )
            throw new Error(`Invalid internal range: ${name}/${dep}`);
          expectedDeps[dep] = next;
        }
        expected[field] = expectedDeps;
      }
      equal(after, expected, `${name} manifest`);
    }
    const currentWorkspaces = object(json(await read(head, "bun.lock")).workspaces);
    for (const [name, { after, path }] of manifests) {
      if (!bumped.has(name)) continue;
      const workspace = path.slice(0, -"/package.json".length);
      if (object(currentWorkspaces[workspace]).version !== after.version)
        throw new Error(`Stale lockfile workspace version: ${name}`);
    }
    const changes = (await git(["diff", "--raw", "--no-abbrev", "--no-renames", base, head], cwd))
      .trim()
      .split("\n");
    const consumed = new Map<string, string>();
    let hasLock = false,
      hasChangelog = false;
    await Promise.all(
      changes.map(async (change) => {
        const match = /^:(\d+) (\d+) [a-f0-9]+ [a-f0-9]+ ([AMD])\t(.+)$/.exec(change);
        if (!match) throw new Error("Unsupported change");
        const [, oldMode, newMode, status, pathValue] = match;
        const path = string(pathValue);
        if (
          (oldMode !== "100644" && oldMode !== "000000") ||
          (newMode !== "100644" && newMode !== "000000")
        )
          throw new Error(`Non-regular file: ${path}`);
        if ([...manifests.values()].some((pkg) => pkg.path === path)) {
          if (status !== "M") throw new Error("Manifest added/deleted");
        } else if (path === "bun.lock" && status === "M") {
          const before = json(await read(base, path)),
            after = json(await read(head, path));
          const expected = structuredClone(before),
            workspaces = object(expected.workspaces);
          const nextWorkspaces = object(after.workspaces);
          for (const {
            before: oldManifest,
            after: manifest,
            path: manifestPath,
          } of manifests.values()) {
            const workspace =
              manifestPath === "package.json" ? "" : manifestPath.slice(0, -"/package.json".length);
            const previous = object(workspaces[workspace]),
              next = object(nextWorkspaces[workspace]);
            if (previous.version !== next.version) {
              if (!bumped.has(string(manifest.name)) || next.version !== manifest.version)
                throw new Error("Mismatched lockfile version");
              previous.version = next.version;
            }
            for (const field of dependencyFields) {
              if (isDeepStrictEqual(previous[field], next[field])) continue;
              const oldDeps = object(previous[field]),
                newDeps = object(next[field]);
              const oldManifestDeps = object(oldManifest[field]),
                manifestDeps = object(manifest[field]);
              for (const dep of Object.keys(newDeps)) {
                if (oldDeps[dep] === newDeps[dep]) continue;
                if (
                  !bumped.has(dep) ||
                  oldManifestDeps[dep] === manifestDeps[dep] ||
                  newDeps[dep] !== manifestDeps[dep]
                )
                  throw new Error("Mismatched lockfile dependency");
                oldDeps[dep] = newDeps[dep];
              }
            }
          }
          equal(after, expected, "bun.lock");
        } else if (/^\.tegami\/[\w-]+\.md$/.test(path) && status === "D") {
          const content = await read(base, path);
          const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
          if (!frontmatter) throw new Error("Invalid consumed release note");
          const metadata = object(parseYaml(frontmatter[1] ?? ""));
          equal(Object.keys(metadata), ["packages"], "release-note fields");
          const packages = object(metadata.packages);
          if (
            Object.keys(packages).length === 0 ||
            Object.entries(packages).some(
              ([name, bump]) =>
                !bumped.has(name) || !["patch", "minor", "major"].includes(string(bump)),
            )
          )
            throw new Error("Invalid consumed release-note package");
          consumed.set(path.slice(".tegami/".length), content);
        } else if (path === ".tegami/publish-lock.yaml" && status === "M") {
          hasLock = true;
        } else {
          const pkg = [...manifests.values()].find(
            (entry) => path === entry.path.replace("package.json", "CHANGELOG.md"),
          );
          if (!pkg || !bumped.has(string(pkg.after.name)) || !["A", "M"].includes(string(status)))
            throw new Error(`Disallowed path: ${path}`);
          const before = status === "A" ? "" : await read(base, path),
            after = await read(head, path);
          if (
            !after.startsWith(`## ${string(pkg.after.name)}@${string(pkg.after.version)}\n`) ||
            !after.endsWith(before) ||
            after === before
          )
            throw new Error("Changelog must prepend the generated version entry");
          hasChangelog = true;
        }
      }),
    );
    if (!hasLock || !hasChangelog || consumed.size === 0)
      throw new Error("Incomplete generated release metadata");
    const lock = object(parseYaml(await read(head, ".tegami/publish-lock.yaml")));
    equal(
      Object.keys(lock).sort(),
      ["core:changelogs", "core:packages", "npm:packages"],
      "publish-lock fields",
    );
    const notes = lock["core:changelogs"];
    if (!Array.isArray(notes) || notes.length !== consumed.size)
      throw new Error("Mismatched consumed notes");
    for (const value of notes) {
      const note = object(value),
        filename = string(note.filename),
        original = consumed.get(filename);
      equal(Object.keys(note).sort(), ["content", "filename", "v"], "publish-lock note fields");
      if (!original || note.v !== "0.0.0") throw new Error("Unexpected publish-lock note");
      // Tegami canonicalizes frontmatter before writing the lock.
      const normalize = (text: string) => {
        const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
        if (!match) throw new Error("Invalid locked note");
        const meta = object(parseYaml(match[1] ?? "")),
          packages = object(meta.packages);
        return {
          body: match[2],
          packages: Object.fromEntries(
            Object.entries(packages).map(([name, bump]) => [
              name,
              typeof bump === "string" ? { type: bump } : bump,
            ]),
          ),
        };
      };
      equal(normalize(string(note.content)), normalize(original), "consumed note content");
      consumed.delete(filename);
    }
    if (consumed.size) throw new Error("Duplicate or omitted consumed note");
    for (const field of ["core:packages", "npm:packages"]) {
      const packages = lock[field];
      if (!Array.isArray(packages) || packages.length !== manifests.size)
        throw new Error("Invalid publish-lock package list");
      const ids = new Set<string>();
      for (const value of packages) {
        const pkg = object(value),
          id = string(pkg.id),
          name = id.replace(/^npm:/, "");
        if (id !== `npm:${name}` || !manifests.has(name) || ids.has(id))
          throw new Error("Unknown/duplicate locked package");
        ids.add(id);
        if (field === "npm:packages") equal(Object.keys(pkg), ["id"], "npm package fields");
        else {
          if (
            Object.keys(pkg).some((key) => !["id", "updated", "changelogIds"].includes(key)) ||
            pkg.updated !== bumped.has(name)
          )
            throw new Error("Invalid locked package state");
          if (
            pkg.changelogIds !== undefined &&
            (!Array.isArray(pkg.changelogIds) ||
              pkg.changelogIds.some(
                (noteId) => !notes.some((note) => object(note).filename === noteId),
              ))
          )
            throw new Error("Unknown locked changelog");
        }
      }
    }
    return {
      metadataOnly: true,
      reason: "Trusted generated release metadata; full gates run before publication",
    };
  } catch (error) {
    return { metadataOnly: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
