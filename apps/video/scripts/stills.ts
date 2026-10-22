/* eslint-disable no-await-in-loop -- Each renderer uses parallel Chrome workers; serialize exports to bound memory. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stillIds } from "../src/cuts";
import { app, stillDir } from "./projects";

const output = join(app, "renders/stills");
await mkdir(output, { recursive: true });
for (const id of stillIds) {
  // Stills use the same render compositor as the film, then extract its settled frame.
  const movie = join(app, ".build", `${id}.mp4`);
  await run([
    join(app, "node_modules/.bin/hyperframes"),
    "render",
    stillDir(id),
    "--quality",
    "delivery",
    "--output",
    movie,
    "--quiet",
  ]);
  const png = join(output, `${id}-1920x1080.png`);
  await run(["ffmpeg", "-y", "-v", "error", "-ss", "2", "-i", movie, "-frames:v", "1", png]);
  await run([
    "ffmpeg",
    "-y",
    "-v",
    "error",
    "-i",
    png,
    "-vf",
    "scale=1200:630:force_original_aspect_ratio=decrease,pad=1200:630:(ow-iw)/2:(oh-ih)/2:color=0xfbfbf9",
    "-frames:v",
    "1",
    join(output, `${id}-1200x630.png`),
  ]);
}
async function run(command: string[]) {
  const process = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  if ((await process.exited) !== 0) throw new Error(`failed: ${command[0]}`);
}
