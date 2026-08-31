import { assert, describe, it } from "@effect/vitest";

import { Connection, DomainName, ProviderDiscovery, Zones } from "../../src/promise.ts";
import * as ProviderAuthorization from "../../src/auth/authorization.ts";

const connection: Connection.ProviderConnection = {
  createdAt: new Date("2026-08-27T00:00:00.000Z"),
  id: "connection-1",
  method: "token",
  ownerId: "organization-1",
  providerId: "cloudflare",
  status: "active",
};

const authorization: ProviderAuthorization.ProviderAuthorization = {
  authorizedById: "subject-1",
  capabilityEvidence: [
    { capability: "dns:read", evidence: ProviderAuthorization.Evidence.Declared() },
    { capability: "dns:write", evidence: ProviderAuthorization.Evidence.Declared() },
  ],
  createdAt: new Date("2026-08-27T00:00:00.000Z"),
  id: "authorization-1",
  method: "token",
  providerContext: { value: {}, version: "cloudflare.v1" },
  providerId: "cloudflare",
  requiredCapabilities: ["dns:read", "dns:write"],
  revocation: { _tag: "Active" },
  scopes: [],
};

const attachment: Connection.DomainAttachment = {
  connectionId: connection.id,
  createdAt: new Date("2026-08-27T00:00:00.000Z"),
  domain: DomainName.parse("www.example.com"),
  id: "attachment-1",
  target: {
    accountId: "account-1",
    accountKind: "account",
    zoneId: "zone-1",
    zoneName: DomainName.parse("example.com"),
  },
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

  it("selects the unique attached provider zone with decisive nameserver evidence", () => {
    const selection = ProviderDiscovery.select({
      authoritativeNameservers: ["ADA.NS.CLOUDFLARE.COM.", "BOB.NS.CLOUDFLARE.COM"],
      connectedZones: [
        {
          authorization,
          attachment,
          connection,
          nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
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
          attachment,
          connection,
          nameservers: ["ada.ns.cloudflare.com"],
        },
      ],
      domain: "www.example.com",
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

  it("matches an explicit provider account to the exact attachment target", () => {
    const selection = ProviderDiscovery.select({
      authoritativeNameservers: [],
      connectedZones: [{ authorization, attachment, connection, nameservers: [] }],
      domain: "www.example.com",
      explicit: { accountId: "account-1", providerId: "cloudflare", zone: "example.com" },
    });
    assert.strictEqual(selection._tag, "selected");
  });
});
