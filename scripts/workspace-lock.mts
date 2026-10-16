import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { isDeepStrictEqual } from "node:util";
import { object } from "./release-metadata.mts";

/** Bun does not invalidate cached workspace metadata for version/range-only manifest changes. */
export function syncWorkspaceLock(
  text: string,
  manifests: ReadonlyMap<string, Record<string, unknown>>,
) {
  const errors: ParseError[] = [];
  const lock = object(parse(text, errors, { allowTrailingComma: true }));
  if (errors.length) throw new Error("Invalid Bun lockfile");
  const workspaces = object(lock.workspaces);
  for (const [workspace, manifest] of manifests) {
    const entry = object(workspaces[workspace]);
    for (const field of [
      "name",
      "version",
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      if (isDeepStrictEqual(manifest[field], entry[field])) continue;
      if (field.endsWith("Dependencies") || field === "dependencies") {
        const before = entry[field] === undefined ? {} : object(entry[field]);
        const after = manifest[field] === undefined ? {} : object(manifest[field]);
        if (manifest[field] === undefined || entry[field] === undefined) {
          text = applyEdits(
            text,
            modify(text, ["workspaces", workspace, field], manifest[field], {}),
          );
        } else
          for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (before[name] === after[name]) continue;
            text = applyEdits(
              text,
              modify(text, ["workspaces", workspace, field, name], after[name], {}),
            );
          }
      } else
        text = applyEdits(
          text,
          modify(text, ["workspaces", workspace, field], manifest[field], {}),
        );
    }
  }
  return text;
}
