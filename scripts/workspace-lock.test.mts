import { expect, test } from "bun:test";
import { parse } from "jsonc-parser";
import { syncWorkspaceLock } from "./workspace-lock.mts";

test("synchronizes version/range-only workspace metadata without changing resolutions", () => {
  const packages = { "external": ["external@1.0.0", "", {}, "integrity"] };
  const before = { lockfileVersion: 2, workspaces: {
    "": { name: "old-root" },
    "packages/core": { name: "domainkit", version: "0.20.0" },
    "packages/react": { name: "@domainkit/react", version: "0.20.0", dependencies: { domainkit: "workspace:^0.20.0" } },
  }, packages };
  const manifests = new Map<string, Record<string, unknown>>([
    ["", { name: "domainkit-workspace", private: true, scripts: { test: "not locked" } }],
    ["packages/core", { name: "domainkit", version: "0.21.0" }],
    ["packages/react", { name: "@domainkit/react", version: "0.21.0", dependencies: { domainkit: "workspace:^0.21.0" } }],
  ]);
  const synced: unknown = parse(syncWorkspaceLock(JSON.stringify(before), manifests));
  expect(synced).toEqual({ ...before, workspaces: {
    "": { name: "domainkit-workspace" },
    "packages/core": { name: "domainkit", version: "0.21.0" },
    "packages/react": { name: "@domainkit/react", version: "0.21.0", dependencies: { domainkit: "workspace:^0.21.0" } },
  } });
});
test("rejects invalid or missing workspace lock state", () => {
  expect(() => syncWorkspaceLock("invalid", new Map())).toThrow();
  expect(() => syncWorkspaceLock('{"workspaces":{}}', new Map([["missing", { name: "missing" }]]))).toThrow();
});
