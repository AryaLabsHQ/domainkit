import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Storage } from "domainkit";
import { Emit, Manifest } from "capsuledb";
import { Context, Effect, Layer } from "effect";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { PgStorage } from "../src/index.ts";
import { capsule } from "../src/capsule.ts";
import { type Postgres, start } from "./postgres.ts";

interface EmitIndex {
  readonly files: ReadonlyArray<{ readonly path: string; readonly checksum: string }>;
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
  const out = directory;
  const manifest = await Effect.runPromise(Manifest.buildManifest({ capsules: [capsule] }));
  const files = await Effect.runPromise(Emit.emit(manifest, { dialect: "postgres" }));
  await Promise.all(
    files.map(async (file) => {
      const path = join(out, file.path);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, file.contents);
    }),
  );
  const index = Emit.indexOf(files);
  if (index === undefined) throw new Error("CapsuleDB did not produce an emit index");
  await writeFile(join(out, "capsuledb.emit.json"), JSON.stringify(index));
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
    const sqlFiles = index.files.map(({ path }) => path).filter((path) => path.endsWith(".sql"));
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
    assert.strictEqual(typeof Context.get(context, Storage.Service).withLock, "function");
  }, 180_000);

  it("declares the eight tables the emitted SQL creates", async () => {
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
      "domainkit_batches",
      "domainkit_batch_items",
    ]);
    const index = JSON.parse(await readFile(join(out, "capsuledb.emit.json"), "utf8")) as EmitIndex;
    const migrationFile = index.files.find(({ path }) => path.startsWith("0001_"))?.path;
    assert.ok(migrationFile !== undefined, "emit numbers the capsule migration 0001");
    const migration = await readFile(join(out, migrationFile), "utf8");
    // The batch tables arrived in their own migration, so the first one creates the other six.
    const initial = names.filter((name) => !name.startsWith("domainkit_batch"));
    for (const name of initial) {
      assert.ok(migration.includes(name), `emitted SQL creates ${name}`);
    }
    assert.ok(
      !migration.includes("domainkit_batches"),
      "the first migration predates the batch aggregate",
    );
    // The first migration is history: the label columns arrived later and are added by their own
    // migrations, so an installation that already ran 0001 reads the same checksum for it.
    assert.ok(!migration.includes("label"), "the first migration predates every label column");
    const added = index.files
      .map(({ path }) => path)
      .filter((path) => path.endsWith(".sql") && !path.startsWith("0001_"));
    const later = await Promise.all(added.map((file) => readFile(join(out, file), "utf8")));
    assert.ok(
      later.some((sql) => sql.includes("domainkit_authorizations") && sql.includes("label")),
      "a later migration adds the authorization label column",
    );
    assert.ok(
      later.some(
        (sql) => sql.includes("domainkit_batches") && sql.includes("domainkit_batch_items"),
      ),
      "a later migration creates the batch tables",
    );
  });
});
