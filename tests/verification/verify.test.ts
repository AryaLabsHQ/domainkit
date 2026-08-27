import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { parseDnsRecord, parseDomainName, verifyRecord } from "../../src/index.ts";
import { verifyRecord as verifyRecordEffect } from "../../src/effect.ts";
import { InMemoryDnsProvider, InMemoryDnsResolver } from "../../src/testing.ts";

const record = parseDnsRecord({
  _tag: "CNAME",
  metadata: { ownership: "example-app", provenance: "test", purpose: "Route traffic" },
  name: "track.example.com",
  policy: "exclusive",
  target: "destination.example.net",
  ttl: 300,
});

describe("record verification", () => {
  it("keeps provider readback and public propagation as separate evidence", async () => {
    const provider = new InMemoryDnsProvider({ records: { "example.com": [record] } });
    const resolver = new InMemoryDnsResolver(() => ({
      _tag: "answer",
      answers: [
        {
          data: "destination.example.net.",
          name: parseDomainName("track.example.com"),
          ttl: 60,
          type: "CNAME",
        },
      ],
    }));
    const verified = await Effect.runPromise(
      verifyRecordEffect({ record, zone: parseDomainName("example.com") }).pipe(
        Effect.provide(Layer.merge(provider.layer, resolver.layer)),
      ),
    );
    expect(verified).toEqual({
      provider: { _tag: "match" },
      publicDns: { _tag: "propagated" },
      status: "verified",
    });

    const pending = await verifyRecord({
      provider: provider.promise,
      record,
      resolver: new InMemoryDnsResolver(() => ({ _tag: "nodata" })).promise,
      zone: parseDomainName("example.com"),
    });
    expect(pending).toMatchObject({
      provider: { _tag: "match" },
      publicDns: { _tag: "missing" },
      status: "pending",
    });
  });

  it("distinguishes mismatch, timeout, and provider failure", async () => {
    const empty = new InMemoryDnsProvider();
    const mismatch = await verifyRecord({
      provider: empty.promise,
      record,
      resolver: new InMemoryDnsResolver(() => ({
        _tag: "answer",
        answers: [
          {
            data: "wrong.example.net",
            name: record.name,
            ttl: 60,
            type: "CNAME",
          },
        ],
      })).promise,
      zone: parseDomainName("example.com"),
    });
    expect(mismatch).toMatchObject({ publicDns: { _tag: "mismatch" }, status: "mismatch" });

    const timeout = await verifyRecord({
      provider: empty.promise,
      record,
      resolver: {
        resolve: async () => ({ _tag: "timeout" }),
      },
      zone: parseDomainName("example.com"),
    });
    expect(timeout).toMatchObject({ publicDns: { _tag: "timeout" }, status: "unavailable" });
  });

  it("does not accept matching data from a different owner name", async () => {
    const provider = new InMemoryDnsProvider({ records: { "example.com": [record] } });
    const observation = await verifyRecord({
      provider: provider.promise,
      record,
      resolver: new InMemoryDnsResolver(() => ({
        _tag: "answer",
        answers: [
          {
            data: "destination.example.net",
            name: parseDomainName("other.example.com"),
            ttl: 60,
            type: "CNAME",
          },
        ],
      })).promise,
      zone: parseDomainName("example.com"),
    });
    expect(observation).toMatchObject({ publicDns: { _tag: "mismatch" }, status: "mismatch" });
  });
});
