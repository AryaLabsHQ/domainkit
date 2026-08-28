import { assert, describe, it } from "@effect/vitest";

import {
  Connection,
  DomainName,
  ProviderAuthorization,
  ProviderDiscovery,
  Zones,
} from "../../src/index.ts";

const connection: Connection.Connection = {
  authorizationId: "authorization-1",
  createdAt: new Date("2026-08-27T00:00:00.000Z"),
  grant: { _tag: "account" },
  id: "connection-1",
  ownerId: "organization-1",
};

const authorization: ProviderAuthorization.ProviderAuthorization = {
  accountId: "account-1",
  capabilities: ["dns:read", "dns:write"],
  createdAt: new Date("2026-08-27T00:00:00.000Z"),
  expiresAt: null,
  id: "authorization-1",
  kind: "token",
  providerId: "cloudflare",
  scopes: [],
  subjectId: "subject-1",
};

describe("provider discovery", () => {
  it("derives candidates from the registrable domain", () => {
    assert.deepStrictEqual(Zones.candidates("a.b.example.co.uk"), [
      DomainName.parse("a.b.example.co.uk"),
      DomainName.parse("b.example.co.uk"),
      DomainName.parse("example.co.uk"),
    ]);
    assert.deepStrictEqual(Zones.candidates("www.bücher.de"), [
      DomainName.parse("www.xn--bcher-kva.de"),
      DomainName.parse("xn--bcher-kva.de"),
    ]);
  });

  it("selects the unique connected zone with decisive nameserver evidence", () => {
    const selection = ProviderDiscovery.select({
      authoritativeNameservers: ["ADA.NS.CLOUDFLARE.COM.", "BOB.NS.CLOUDFLARE.COM"],
      connectedZones: [
        {
          authorization,
          connection,
          nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
          providerId: "cloudflare",
          zone: "example.com",
        },
      ],
      domain: "www.example.com",
    });
    assert.strictEqual(selection._tag, "selected");
    if (selection._tag === "selected") {
      assert.strictEqual(selection.reason, "unique-nameserver-match");
      assert.deepStrictEqual(selection.candidate.matchedNameservers, [
        DomainName.parse("ada.ns.cloudflare.com"),
        DomainName.parse("bob.ns.cloudflare.com"),
      ]);
    }
  });

  it("returns manual selection when nameserver evidence is unsupported", () => {
    const selection = ProviderDiscovery.select({
      authoritativeNameservers: ["ns1.unknown.example"],
      connectedZones: [
        {
          authorization,
          connection,
          nameservers: ["ada.ns.cloudflare.com"],
          providerId: "cloudflare",
          zone: "example.com",
        },
      ],
      domain: "example.com",
    });
    assert.deepStrictEqual(selection, {
      _tag: "manual",
      evidence: [
        {
          accountId: "account-1",
          connectionId: "connection-1",
          decisiveNameserverMatch: false,
          matchedNameservers: [],
          providerId: "cloudflare",
          zone: DomainName.parse("example.com"),
        },
      ],
      reason: "unsupported",
    });
  });
});
