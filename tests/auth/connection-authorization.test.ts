import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  ConnectionAuthorization,
  DnsProvider,
  DnsRecord,
  Digest,
  DomainName,
  Provisioning,
  type Connection,
  type ProviderAuthorization,
} from "../../src/effect.ts";
import { InMemoryDnsProvider } from "../../src/testing.ts";

const authorization: ProviderAuthorization.ProviderAuthorization = {
  accountId: "account-1",
  capabilities: ["dns:read", "dns:write"],
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  expiresAt: null,
  id: "authorization-1",
  kind: "oauth2",
  providerId: "test",
  scopes: ["dns:read", "dns:write"],
  subjectId: "user-1",
};

const connection: Connection.Connection = {
  authorizationId: authorization.id,
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  grant: { _tag: "domains", domains: [DomainName.parse("mail.example.com")] },
  id: "connection-1",
  ownerId: "organization-1",
};

describe("connection authorization", () => {
  it.effect("authorizes a subdomain plan stored in its parent provider zone", () => {
    const provider = InMemoryDnsProvider.make({ id: authorization.providerId });
    const layer = Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer);
    return Effect.gen(function* () {
      const plan = yield* Provisioning.create({
        requirements: [
          DnsRecord.parse({
            _tag: "TXT",
            metadata: { ownership: "customer", provenance: "test", purpose: "verification" },
            name: "mail.example.com",
            policy: "append",
            ttl: 300,
            value: "proof",
          }),
        ],
        zone: "example.com",
      });
      const approved = yield* ConnectionAuthorization.authorize({
        authorization,
        connection,
        domain: "mail.example.com",
        plan,
      });
      assert.strictEqual(approved.planDigest, plan.digest);
    }).pipe(Effect.provide(layer));
  });
});
