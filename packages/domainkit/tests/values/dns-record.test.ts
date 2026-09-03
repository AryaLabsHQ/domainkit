import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";

import { DnsRecord } from "../../src/index.ts";

describe("DnsRecord", () => {
  it("applies policy and ttl defaults per record type", () => {
    const cname = DnsRecord.cname({ name: "App.Example.com", target: "edge.acme.dev." });
    assert.strictEqual(cname.policy, "exclusive");
    assert.strictEqual(cname.ttl, null);
    assert.strictEqual(cname.name, "app.example.com");
    assert.strictEqual(cname.target, "edge.acme.dev");
    assert.strictEqual("purpose" in cname, false);

    const txt = DnsRecord.txt({
      name: "_acme.example.com",
      value: "x",
      ttl: 300,
      purpose: "Prove",
    });
    assert.strictEqual(txt.policy, "append");
    assert.strictEqual(txt.ttl, 300);
    assert.strictEqual(txt.purpose, "Prove");
  });

  it("rejects malformed data at construction", () => {
    assert.throws(() => DnsRecord.a({ name: "example.com", address: "999.1.1.1" }));
    assert.throws(() => DnsRecord.aaaa({ name: "example.com", address: "not-v6" }));
    assert.throws(() => DnsRecord.txt({ name: "example.com", value: "" }));
    assert.throws(() =>
      DnsRecord.mx({ name: "example.com", exchange: "mx.example.com", priority: 70_000 }),
    );
  });

  it("renders canonical data and compares structurally without metadata", () => {
    const left = DnsRecord.mx({
      name: "example.com",
      exchange: "MX.Example.com",
      priority: 10,
      ttl: 60,
    });
    const right = DnsRecord.mx({
      name: "example.com",
      exchange: "mx.example.com",
      priority: 10,
      purpose: "mail",
    });
    assert.strictEqual(DnsRecord.data(left), "10 mx.example.com");
    assert.strictEqual(DnsRecord.equals(left, right), true);
    assert.strictEqual(
      DnsRecord.sameSet(left, DnsRecord.txt({ name: "example.com", value: "v" })),
      false,
    );
    const opaque = new DnsRecord.Opaque({ name: "example.com", type: "HTTPS", raw: { a: 1 } });
    assert.strictEqual(DnsRecord.equals(opaque, left), false);
    assert.strictEqual(
      DnsRecord.equals(
        opaque,
        new DnsRecord.Opaque({ name: "example.com", type: "HTTPS", raw: { a: 1 } }),
      ),
      true,
    );
    assert.strictEqual(
      DnsRecord.data(
        DnsRecord.srv({
          name: "_sip._tcp.example.com",
          target: "sip.example.com",
          port: 5060,
          priority: 10,
          weight: 5,
        }),
      ),
      "10 5 5060 sip.example.com",
    );
  });

  it("round-trips through the union codec", () => {
    const record = DnsRecord.caa({
      name: "example.com",
      flags: 0,
      tag: "issue",
      value: "letsencrypt.org",
    });
    const encoded = Schema.encodeSync(DnsRecord.Model)(record);
    assert.deepStrictEqual(encoded, {
      _tag: "CAA",
      name: "example.com",
      ttl: null,
      policy: "append",
      flags: 0,
      tag: "issue",
      value: "letsencrypt.org",
    });
    const decoded = Schema.decodeUnknownSync(DnsRecord.Observed)(encoded);
    assert.ok(decoded instanceof DnsRecord.CAA);
    assert.strictEqual(DnsRecord.isDnsRecord(decoded), true);
    assert.strictEqual(DnsRecord.isDnsRecord({ _tag: "CAA" }), false);
  });
});
