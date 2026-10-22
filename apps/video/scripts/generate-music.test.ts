import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import { submitMusic } from "./generate-music";

const apiKey = "offline-secret-never-log";
const requestId = "01a16258-2293-7501-8ef0-968c3d9afdc3";
const fetchStub = spyOn(globalThis, "fetch");

afterAll(() => {
  fetchStub.mockRestore();
});

afterEach(() => {
  fetchStub.mockReset();
});

describe("paid music submission", () => {
  test("does not retry a retryable HTTP failure or expose its response body", async () => {
    fetchStub.mockResolvedValue(new Response(apiKey, { status: 503 }));

    await expect(submitMusic(apiKey)).rejects.toThrow(
      "Music submission failed: HTTP 503; inspect reserved receipt before any retry",
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  test("does not retry a lost response or expose the transport error", async () => {
    fetchStub.mockRejectedValue(new Error(`Lost response with Authorization: Key ${apiKey}`));

    await expect(submitMusic(apiKey)).rejects.toThrow(
      "Music submission outcome unknown; inspect reserved receipt before any retry",
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  test("submits the music input once and validates the returned request ID", async () => {
    fetchStub.mockResolvedValue(Response.json({ request_id: requestId }));

    expect(await submitMusic(apiKey)).toBe(requestId);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const call = fetchStub.mock.calls[0];
    expect(call?.[0]).toBe("https://queue.fal.run/elevenlabs/music/v2.5");
    expect(call?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      music_length_ms: 60_000,
      force_instrumental: true,
      output_format: "mp3_48000_192",
    });
  });

  test.each([null, {}, { request_id: 42 }, { request_id: "" }, { request_id: apiKey }])(
    "rejects invalid request IDs without reflecting response data: %j",
    async (body) => {
      fetchStub.mockResolvedValue(Response.json(body));

      await expect(submitMusic(apiKey)).rejects.toThrow(
        "Music submission returned no valid request ID; inspect reserved receipt before any retry",
      );
      expect(fetchStub).toHaveBeenCalledTimes(1);
    },
  );

  test("redacts invalid JSON errors without resubmitting", async () => {
    fetchStub.mockResolvedValue(new Response(apiKey));

    await expect(submitMusic(apiKey)).rejects.toThrow(
      "Music submission response unreadable; inspect reserved receipt before any retry",
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
