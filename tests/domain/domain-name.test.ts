import { describe, expect, it } from "vitest";

import { parseDomainName } from "../../src/domain/domain-name.ts";

describe("parseDomainName", () => {
  it("normalizes case, trailing dots, and international labels", () => {
    expect(parseDomainName("WWW.Example.COM.")).toBe("www.example.com");
    expect(parseDomainName("bücher.example")).toBe("xn--bcher-kva.example");
  });

  it("permits DNS service labels and rejects relative names", () => {
    expect(parseDomainName("_sip._tcp.example.com")).toBe("_sip._tcp.example.com");
    expect(() => parseDomainName("localhost")).toThrow();
  });
});
