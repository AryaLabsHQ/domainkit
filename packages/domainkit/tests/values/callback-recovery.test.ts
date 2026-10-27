import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";

import { CallbackRecovery } from "../../src/index.ts";
import { CallbackRecovery as ClientRecovery } from "../../src/entry/client.ts";

describe("CallbackRecovery", () => {
  it("exposes the same browser-safe codec from the client entry point", () => {
    assert.strictEqual(ClientRecovery, CallbackRecovery);
  });

  for (const kind of ["cancelled", "restart", "inspect"] as const) {
    it(`roundtrips ${kind} with a custom provider`, () => {
      const outcome: CallbackRecovery.Model = { kind, provider: "custom provider/+" };
      assert.isTrue(Schema.is(CallbackRecovery.Model)(outcome));
      const url = CallbackRecovery.write(new URL("https://app.test/domains"), outcome);
      assert.deepStrictEqual(CallbackRecovery.read(url), outcome);
    });
  }

  for (const kind of ["cancelled", "restart", "inspect"] as const) {
    it(`roundtrips ${kind} reconnect metadata`, () => {
      const outcome: CallbackRecovery.Model = {
        kind,
        provider: "custom",
        connectionId: "conn /+?&",
      };
      assert.isTrue(Schema.is(CallbackRecovery.Model)(outcome));
      const url = CallbackRecovery.write(new URL("https://app.test/domains"), outcome);
      assert.deepStrictEqual(url.searchParams.getAll("domainkit-connection"), [
        outcome.connectionId,
      ]);
      assert.deepStrictEqual(CallbackRecovery.read(url), outcome);
    });
  }

  it("rejects malformed connection metadata at the schema boundary", () => {
    for (const connectionId of ["", null, 42, {}]) {
      assert.isFalse(
        Schema.is(CallbackRecovery.Model)({ kind: "restart", provider: "fake", connectionId }),
      );
    }
  });

  for (const query of [
    "",
    "domainkit=cancelled",
    "domainkit-provider=fake",
    "domainkit=&domainkit-provider=fake",
    "domainkit=connected&domainkit-provider=fake",
    "domainkit=CANCELLED&domainkit-provider=fake",
    "domainkit=%FF&domainkit-provider=fake",
    "domainkit=cancelled&domainkit-provider=",
    "domainkit=cancelled&domainkit=cancelled&domainkit-provider=fake",
    "domainkit=cancelled&domainkit=restart&domainkit-provider=fake",
    "domainkit=inspect&domainkit-provider=fake&domainkit-provider=fake",
    "domainkit=inspect&domainkit-provider=fake&domainkit-provider=other",
    "domainkit=inspect&domainkit-provider=fake&domainkit-provider=",
    "domainkit-connection=conn",
    "domainkit=restart&domainkit-connection=conn",
    "domainkit-provider=fake&domainkit-connection=conn",
    "domainkit=restart&domainkit-provider=fake&domainkit-connection=",
    "domainkit=restart&domainkit-provider=fake&domainkit-connection=conn&domainkit-connection=conn",
    "domainkit=inspect&domainkit-provider=fake&domainkit-connection=conn&domainkit-connection=other",
  ]) {
    it(`ignores invalid recovery input ${JSON.stringify(query)}`, () => {
      assert.strictEqual(CallbackRecovery.read(new URL(`https://app.test/?${query}`)), null);
    });
  }

  it("replaces all stale hints without mutating the input or dropping other parameters and hash", () => {
    const url = new URL(
      "https://app.test/domains?view=dns&domainkit=old&tab=one&domainkit=inspect&tab=two&domainkit-provider=old&domainkit-provider=other&domainkit-connection=stale&domainkit-connection=other#records",
    );
    const original = url.toString();
    const outcome: CallbackRecovery.Model = { kind: "restart", provider: "fake" };
    const result = CallbackRecovery.write(url, outcome);
    assert.notStrictEqual(result, url);
    assert.strictEqual(url.toString(), original);
    assert.strictEqual(
      result.toString(),
      "https://app.test/domains?view=dns&tab=one&tab=two&domainkit=restart&domainkit-provider=fake#records",
    );
    assert.deepStrictEqual(CallbackRecovery.read(result), outcome);
  });

  it("replaces every stale connection id with the reconnect id", () => {
    const url = new URL(
      "https://app.test/domains?domainkit=restart&domainkit-provider=old&domainkit-connection=stale&domainkit-connection=other#records",
    );
    const result = CallbackRecovery.write(url, {
      kind: "cancelled",
      provider: "fake",
      connectionId: "conn_current",
    });
    assert.deepStrictEqual(result.searchParams.getAll("domainkit-connection"), ["conn_current"]);
    assert.deepStrictEqual(CallbackRecovery.read(result), {
      kind: "cancelled",
      provider: "fake",
      connectionId: "conn_current",
    });
    assert.strictEqual(result.hash, "#records");
  });

  it("clears all hints from a clone and preserves unrelated parameters and hash", () => {
    const url = new URL(
      "https://app.test/domains?domainkit=restart&view=dns&domainkit=inspect&domainkit-provider=fake&domainkit-provider=other&domainkit-connection=stale&domainkit-connection=other#records",
    );
    const original = url.toString();
    const result = CallbackRecovery.write(url, null);
    assert.notStrictEqual(result, url);
    assert.strictEqual(url.toString(), original);
    assert.strictEqual(result.toString(), "https://app.test/domains?view=dns#records");
    assert.strictEqual(CallbackRecovery.read(result), null);
  });

  it("ignores recovery-like text outside the query pair", () => {
    assert.strictEqual(
      CallbackRecovery.read(new URL("https://app.test/domainkit=restart#domainkit-provider=fake")),
      null,
    );
  });
});
