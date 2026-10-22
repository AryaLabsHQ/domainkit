import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { musicFile } from "./media";

/** Missing paid media leaves the film silent; scoring never generates audio. */
export async function scoreMusic(duration: number, assets: string): Promise<string | undefined> {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error(`Music duration must be positive and finite, received ${duration}`);
  const source = musicFile("launch-bed.mp3");
  if (!(await Bun.file(source).exists())) return undefined;
  await mkdir(assets, { recursive: true });

  const levelled = join(assets, "music.levelled.wav");
  const format = "aformat=sample_rates=48000:channel_layouts=stereo";
  // loudnorm's look-ahead must finish before the transition envelope is applied.
  await ffmpeg("level music", [
    "-i",
    source,
    "-af",
    `${format},apad,atrim=duration=${duration},asetpts=PTS-STARTPTS,loudnorm=I=-14:TP=-1.5:LRA=9,${format}`,
    "-c:a",
    "pcm_s24le",
    levelled,
  ]);

  const transitions = [9, 16, 23, 32, 41, 47, 55].filter((time) => time < duration);
  // A smooth 2 dB dip gives each new card breathing room without a voice sidechain.
  const envelope = transitions.map((time) => `exp(-0.5*pow((t-${time})/0.28,2))`).join("+");
  const gain = envelope.length === 0 ? "1" : `pow(10,-2*(${envelope})/20)`;
  const fadeOut = Math.min(1.8, duration / 3);
  await ffmpeg("duck and fade music", [
    "-i",
    levelled,
    "-af",
    `volume='${gain}':eval=frame,volume=-0.3dB,afade=t=in:d=${Math.min(0.3, duration / 3)},afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`,
    "-t",
    String(duration),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    join(assets, "music.mp3"),
  ]);
  return "assets/music.mp3";
}

async function ffmpeg(stage: string, flags: string[]): Promise<void> {
  try {
    const process = Bun.spawn(["ffmpeg", "-y", "-hide_banner", "-v", "error", ...flags], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) throw new Error(`ffmpeg exited ${exitCode}: ${stderr.trim()}`);
  } catch (cause) {
    throw new Error(`Could not ${stage}`, { cause });
  }
}
