import { assert, describe, it } from "@effect/vitest";

import * as ProviderAuthorization from "../src/auth/authorization.ts";
import { DomainName, DnsPlan, DnsRecord, DnsResolver, Vercel } from "../src/index.ts";
import * as PromiseDnsResolver from "../src/promise/dns-resolver.ts";
import * as PromiseVercel from "../src/promise/vercel.ts";

describe("public tagged-value constructors", () => {
  it("constructs schema-backed DNS records without handwritten tags", () => {
    assert.deepStrictEqual(
      DnsRecord.Opaque.make({
        name: DomainName.parse("mail.example.com"),
        providerRecordId: "record-1",
        providerType: "ALIAS",
      }),
      {
        _tag: "Opaque",
        name: DomainName.parse("mail.example.com"),
        providerRecordId: "record-1",
        providerType: "ALIAS",
      },
    );
  });

  it("constructs plan, authorization, and resolver cases", () => {
    const requirement = DnsRecord.Txt.make({
      metadata: { ownership: "customer", provenance: "test", purpose: "verification" },
      name: DomainName.parse("_verify.example.com"),
      policy: "append",
      ttl: 300,
      value: "domainkit",
    });
    assert.deepStrictEqual(ProviderAuthorization.Revocation.Active.make({}), {
      _tag: "Active",
    });
    assert.deepStrictEqual(DnsPlan.Operation.create.make({ id: "operation-1", requirement }), {
      _tag: "create",
      id: "operation-1",
      requirement,
    });
    assert.deepStrictEqual(DnsResolver.Resolution.nodata.make({}), { _tag: "nodata" });
    assert.deepStrictEqual(DnsResolver.AsyncResolution.timeout.make({}), { _tag: "timeout" });
    assert.deepStrictEqual(PromiseDnsResolver.Resolution.failure.make({ message: "offline" }), {
      _tag: "failure",
      message: "offline",
    });
  });

  it("exports Vercel account-scope constructors from both entry points", () => {
    assert.deepStrictEqual(Vercel.AccountContext.personal(), { _tag: "personal" });
    assert.deepStrictEqual(Vercel.AccountContext.team({ teamId: "team-1" }), {
      _tag: "team",
      teamId: "team-1",
    });
    assert.deepStrictEqual(PromiseVercel.AccountContext.personal(), { _tag: "personal" });
  });
});
