import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { CloudflareDnsResolver } from "../../src/effect.ts";
import { parseDomainName } from "../../src/index.ts";

describe("Cloudflare DNS-over-HTTPS resolver", () => {
  it("uses portable Fetch and normalizes record-specific answers", async () => {
    let requested: URL | undefined;
    const resolver = new CloudflareDnsResolver({
      fetch: async (input) => {
        requested = new URL(input instanceof Request ? input.url : input);
        return Response.json({
          Answer: [{ TTL: 120, data: "10 MAIL.EXAMPLE.COM.", name: "example.com.", type: 15 }],
          Status: 0,
        });
      },
    });
    const result = await Effect.runPromise(
      resolver.resolve({ name: parseDomainName("example.com"), type: "MX" }),
    );
    expect(requested?.origin).toBe("https://cloudflare-dns.com");
    expect(requested?.searchParams.get("type")).toBe("MX");
    expect(result).toMatchObject({
      _tag: "answer",
      answers: [{ data: "10 mail.example.com", type: "MX" }],
    });
  });

  it("reports honest resolver failures", async () => {
    const resolver = new CloudflareDnsResolver({
      fetch: async () => new Response(null, { status: 503 }),
    });
    await expect(
      resolver.promise.resolve({ name: parseDomainName("example.com"), type: "A" }),
    ).resolves.toMatchObject({ _tag: "failure" });
  });

  it("classifies bounded resolver timeouts", async () => {
    const resolver = new CloudflareDnsResolver({
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
      timeoutMs: 1,
    });
    await expect(
      resolver.promise.resolve({ name: parseDomainName("example.com"), type: "A" }),
    ).resolves.toEqual({ _tag: "timeout" });
  });
});
