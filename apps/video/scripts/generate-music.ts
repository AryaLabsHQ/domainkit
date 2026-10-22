import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createFalClient } from "@fal-ai/client";

import { musicFile } from "./media";

const endpoint = "elevenlabs/music/v2.5";
const prompt =
  "Exactly 60 seconds of instrumental electronic music for DomainKit, an open-source developer tool launch film with kinetic typography. Precise, confident, warm, understated. 112 BPM, tight dry percussion, rounded analog bass, short plucked synth motifs, airy restrained chords, subtle tactile clicks. Start with an immediate clean pulse for 0-9 seconds; open into a memorable bright motif at 9 seconds; build an orderly connected groove from 16-32 seconds; a small deliberate breath at 32 seconds then a confident lift through 41 seconds; spacious clarity at 41-47 seconds; grounded restrained groove at 47-55 seconds; resolve with a clean warm final chord at 58 seconds and let it decay to silence by 60 seconds. Keep space for typography and visual transitions at 9, 16, 23, 32, 41, 47 and 55 seconds. No vocals, no speech, no narration, no chanting, no vocal chops, no cinematic trailer impacts, no huge drops, no recognizable melodies. Original instrumental only.";
const input = {
  prompt,
  music_length_ms: 60_000,
  force_instrumental: true,
  output_format: "mp3_48000_192",
};
const estimatedCostUsd = 0.6;
const budgetUsd = 1.2; // Allows for minute-rounding at the boundary, still below the task's $5 cap.
export async function submitMusic(apiKey: string): Promise<string> {
  let response: Response;
  try {
    // The SDK queue submit overrides client retry settings. A paid POST must run only once.
    response = await fetch(`https://queue.fal.run/${endpoint}`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Music submission outcome unknown; inspect reserved receipt before any retry");
  }
  if (!response.ok)
    throw new Error(
      `Music submission failed: HTTP ${response.status}; inspect reserved receipt before any retry`,
    );
  let submitted: unknown;
  try {
    submitted = await response.json();
  } catch {
    throw new Error(
      "Music submission response unreadable; inspect reserved receipt before any retry",
    );
  }
  if (
    typeof submitted !== "object" ||
    submitted === null ||
    !("request_id" in submitted) ||
    typeof submitted.request_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submitted.request_id)
  )
    throw new Error(
      "Music submission returned no valid request ID; inspect reserved receipt before any retry",
    );
  return submitted.request_id;
}

class LocalSetupError extends Error {}

async function main(): Promise<void> {
  if (process.argv.slice(2).join(" ") !== "--generate")
    throw new LocalSetupError(
      "Explicit paid command required: cd apps/video && bun run music --generate",
    );

  const source = musicFile("launch-bed.mp3");
  const receipt = musicFile("launch-bed.generation.json");

  if (await Bun.file(source).exists()) {
    console.log(`Existing music retained: ${source}`);
  } else {
    if (await Bun.file(receipt).exists())
      throw new LocalSetupError(
        `Generation already reserved: ${receipt}. Recover the recorded request instead of generating again.`,
      );
    if (!process.env.FAL_KEY) throw new LocalSetupError("FAL_KEY is required in apps/video/.env");
    if (estimatedCostUsd > budgetUsd) throw new LocalSetupError("Music estimate exceeds budget");
    await mkdir(dirname(source), { recursive: true });
    const metadata = {
      endpoint,
      input,
      estimatedCostUsd,
      budgetUsd,
      actualCostUsd: null,
      pricing: "https://fal.ai/models/elevenlabs/music/v2.5",
      pricingObserved: "2026-10-22",
      rateUsdPerRoundedMinute: 0.6,
      createdAt: new Date().toISOString(),
    };
    // Reserve before submitting. An interrupted or failed run must never charge for a second take.
    await writeFile(receipt, `${JSON.stringify({ ...metadata, state: "reserved" }, null, 2)}\n`, {
      flag: "wx",
    });
    const fal = createFalClient({ retry: { maxRetries: 0 } });
    const requestId = await submitMusic(process.env.FAL_KEY);
    await writeFile(
      receipt,
      `${JSON.stringify({ ...metadata, state: "submitted", requestId }, null, 2)}\n`,
    );
    console.log(`Music request ${requestId}; estimated $${estimatedCostUsd.toFixed(2)}`);
    await fal.queue.subscribeToStatus(endpoint, { requestId, pollInterval: 5000 });
    const result = await fal.queue.result(endpoint, { requestId });
    const data: unknown = result.data;
    if (typeof data !== "object" || data === null || !("audio" in data))
      throw new Error(`Music request ${requestId} returned no audio object`);
    const audio = data.audio;
    if (
      typeof audio !== "object" ||
      audio === null ||
      !("url" in audio) ||
      typeof audio.url !== "string"
    )
      throw new Error(`Music request ${requestId} returned no audio URL`);
    const url = new URL(audio.url);
    if (url.protocol !== "https:")
      throw new Error(`Music request ${requestId} returned a non-HTTPS audio URL`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Music download for ${requestId} failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error(`Music request ${requestId} downloaded an empty file`);
    const downloaded = musicFile("launch-bed.download.mp3");
    await writeFile(downloaded, bytes, { flag: "wx" });
    const probe = Bun.spawnSync([
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      downloaded,
    ]);
    const duration = Number(probe.stdout.toString().trim());
    if (!probe.success || !Number.isFinite(duration) || Math.abs(duration - 60) > 0.1)
      throw new Error(
        `Music request ${requestId}: expected 60s audio, received ${duration}s; ffprobe: ${probe.stderr.toString().trim()}`,
      );
    await writeFile(source, bytes, { flag: "wx" });
    await writeFile(
      receipt,
      `${JSON.stringify({ ...metadata, state: "complete", requestId, durationSeconds: duration, bytes: bytes.length, audioUrl: url.href }, null, 2)}\n`,
    );
    console.log(
      `Saved ${source}: ${duration.toFixed(3)}s; actual invoice cost unavailable, estimated $${estimatedCostUsd.toFixed(2)}`,
    );
  }
}

export async function runMusic(): Promise<void> {
  try {
    await main();
  } catch (error) {
    // Only our local setup errors are safe to print; provider errors can contain secrets.
    console.error(
      error instanceof LocalSetupError
        ? error.message
        : "Music generation stopped; inspect the generation receipt before any retry.",
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) await runMusic();
