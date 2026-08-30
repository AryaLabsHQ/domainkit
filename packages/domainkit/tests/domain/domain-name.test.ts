import { assert, describe, it } from "@effect/vitest";

import { DomainName } from "../../src/promise.ts";

describe("DomainName", () => {
  it("normalizes case, trailing dots, and Unicode labels through its schema codec", () => {
    assert.strictEqual(DomainName.parse("WWW.Example.COM."), "www.example.com");
    assert.strictEqual(DomainName.parse("bücher.example"), "xn--bcher-kva.example");
  });

  it("retains service labels", () => {
    assert.strictEqual(DomainName.parse("_sip._tcp.example.com"), "_sip._tcp.example.com");
  });

  it("rejects names without a registrable DNS shape", () => {
    assert.throws(() => DomainName.parse("localhost"));
  });
});
