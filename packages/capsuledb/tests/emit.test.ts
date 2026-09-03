import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Storage } from "domainkit";
import { Context, Effect, Layer } from "effect";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { PgStorage } from "../src/index.ts";
import { capsule } from "../src/capsule.ts";
import { type Postgres, start } from "./postgres.ts";

const execFileAsync = promisify(execFile);
const packageRoot = join(import.meta.dirname, "..");

interface EmitIndex {
  readonly files: ReadonlyArray<string>;
}

/**
 * `capsuledb emit` writes one statement per `;` followed by a blank line, with `--` header lines
 * on top. Splitting on that separator is how a host's own runner would feed a driver that has no
 * multi-statement mode.
 */
const statementsOf = (contents: string): ReadonlyArray<string> =>
  contents
    .split(/;\s*\n\s*\n/)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.startsWith("--"))
        .join("\n")
        .trim()
        .replace(/;$/, ""),
    )
    .filter((statement) => statement.length > 0);

let postgres: Postgres | undefined;
let directory: string | undefined;

beforeAll(async () => {
  postgres = await start(4);
  directory = await mkdtemp(join(tmpdir(), "domainkit-capsuledb-emit-"));
  // The CLI only runs when it is invoked through its own bin path, so use the shim npm installs.
  await execFileAsync(
    join(packageRoot, "node_modules", ".bin", "capsuledb"),
    [
      "emit",
      "--module",
      join(packageRoot, "src", "capsule.ts"),
      "--export",
      "capsule",
      "--dialect",
      "postgres",
      "--out",
      directory,
    ],
    { cwd: packageRoot },
  );
}, 180_000);

afterAll(async () => {
  await postgres?.stop();
  if (directory !== undefined) await rm(directory, { force: true, recursive: true });
});

describe("emitted SQL", () => {
  it("applies with the host's client and then asserts Ready", async () => {
    const suite = postgres;
    const out = directory;
    if (suite === undefined || out === undefined) throw new Error("the suite did not start");

    const index = JSON.parse(await readFile(join(out, "capsuledb.emit.json"), "utf8")) as EmitIndex;
    const sqlFiles = index.files.filter((file) => file.endsWith(".sql"));
    assert.ok(sqlFiles.length >= 3, "emit writes the ledger, the migration, and the readiness row");

    const contents = await Promise.all(sqlFiles.map((file) => readFile(join(out, file), "utf8")));
    const statements = contents.flatMap(statementsOf);
    await Effect.runPromise(
      Effect.forEach(statements, (statement) => suite.client.unsafe(statement)),
    );

    // Assert mode applies nothing: it fails unless the emitted history is already in place.
    const context = await Effect.runPromise(
      Effect.scoped(
        Layer.build(PgStorage.layer({ mode: "assert" }).pipe(Layer.provide(suite.layer))),
      ),
    );
    assert.strictEqual(typeof Context.get(context, Storage.Storage).withLock, "function");
  }, 180_000);

  it("declares the six tables the emitted SQL creates", async () => {
    const out = directory;
    if (out === undefined) throw new Error("the suite did not start");
    const names = capsule.tables.map((table) => table.name);
    assert.deepStrictEqual(names, [
      "domainkit_authorizations",
      "domainkit_connections",
      "domainkit_attachments",
      "domainkit_continuations",
      "domainkit_attempts",
      "domainkit_readiness",
    ]);
    const index = JSON.parse(await readFile(join(out, "capsuledb.emit.json"), "utf8")) as EmitIndex;
    const migrationFile = index.files.find((file) => file.startsWith("0001_"));
    assert.ok(migrationFile !== undefined, "emit numbers the capsule migration 0001");
    const migration = await readFile(join(out, migrationFile), "utf8");
    for (const name of names) {
      assert.ok(migration.includes(name), `emitted SQL creates ${name}`);
    }
  });
});
