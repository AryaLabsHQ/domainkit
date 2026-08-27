import { describe, expect, it } from "vitest";

import {
  deriveZoneCandidates,
  parseDomainName,
  selectProvider,
  type ConnectedZone,
  type Connection,
} from "../../src/index.ts";

function connection(id: string, providerId: string): Connection {
  return {
    accountId: "account-1",
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: null,
    grant: { _tag: "account" },
    id,
    kind: "token",
    providerId,
    scopes: ["dns:write"],
    subjectId: "user-1",
  };
}

function zone(
  providerId: string,
  nameservers: ReadonlyArray<string>,
  name = "example.com",
): ConnectedZone {
  return {
    accountId: "account-1",
    connection: connection(`${providerId}-connection`, providerId),
    nameservers,
    providerId,
    zone: name,
  };
}

describe("zone candidates", () => {
  it("handles apex, nested, IDN, private-suffix, and public-suffix inputs", () => {
    expect(deriveZoneCandidates("example.co.uk")).toEqual([parseDomainName("example.co.uk")]);
    expect(deriveZoneCandidates("a.b.example.co.uk")).toEqual([
      parseDomainName("a.b.example.co.uk"),
      parseDomainName("b.example.co.uk"),
      parseDomainName("example.co.uk"),
    ]);
    expect(deriveZoneCandidates("www.bücher.de")).toEqual([
      parseDomainName("www.xn--bcher-kva.de"),
      parseDomainName("xn--bcher-kva.de"),
    ]);
    expect(deriveZoneCandidates("customer.blogspot.com")).toEqual([
      parseDomainName("customer.blogspot.com"),
    ]);
    expect(() => deriveZoneCandidates("co.uk")).toThrow();
  });
});

describe("provider selection", () => {
  const cloudflare = zone("cloudflare", ["alice.ns.cloudflare.com", "bob.ns.cloudflare.com"]);
  const vercel = zone("vercel", ["ns1.vercel-dns.com", "ns2.vercel-dns.com"]);

  it("honors an authorized explicit provider even when nameservers differ", () => {
    const selected = selectProvider({
      authoritativeNameservers: cloudflare.nameservers,
      connectedZones: [cloudflare, vercel],
      domain: "www.example.com",
      explicit: { accountId: "account-1", providerId: "vercel", zone: "example.com" },
    });
    expect(selected).toMatchObject({
      _tag: "selected",
      candidate: { providerId: "vercel" },
      reason: "explicit",
    });
  });

  it("auto-selects only one decisive connected nameserver match", () => {
    const selected = selectProvider({
      authoritativeNameservers: ["BOB.NS.CLOUDFLARE.COM.", "alice.ns.cloudflare.com"],
      connectedZones: [cloudflare, vercel],
      domain: "www.example.com",
    });
    expect(selected).toMatchObject({
      _tag: "selected",
      candidate: { providerId: "cloudflare" },
      reason: "unique-nameserver-match",
    });
  });

  it("returns evidence and manual fallback for ambiguity or unsupported nameservers", () => {
    const duplicate = {
      ...cloudflare,
      accountId: "account-2",
      connection: { ...cloudflare.connection, accountId: "account-2", id: "other" },
    };
    expect(
      selectProvider({
        authoritativeNameservers: cloudflare.nameservers,
        connectedZones: [cloudflare, duplicate],
        domain: "example.com",
      }),
    ).toMatchObject({ _tag: "manual", reason: "ambiguous" });
    expect(
      selectProvider({
        authoritativeNameservers: ["ns1.unknown.example"],
        connectedZones: [cloudflare, vercel],
        domain: "example.com",
      }),
    ).toMatchObject({ _tag: "manual", reason: "unsupported" });
  });

  it("rejects an explicit zone without a matching connection grant", () => {
    expect(() =>
      selectProvider({
        authoritativeNameservers: [],
        connectedZones: [cloudflare],
        domain: "example.com",
        explicit: { accountId: "account-1", providerId: "vercel", zone: "example.com" },
      }),
    ).toThrow();
  });
});
