/* eslint-disable no-await-in-loop -- Each renderer uses parallel Chrome workers; serialize exports to bound memory. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stillIds } from "../src/cuts";
import { app, outputDir, stillDir } from "./projects";

const output = outputDir;
await mkdir(output, { recursive: true });
for (const id of [...stillIds, "social"]) {
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
  const png = join(id === "social" ? join(app, ".build") : output, `${id}-1920x1080.png`);
  await run(["ffmpeg", "-y", "-v", "error", "-ss", "2", "-i", movie, "-frames:v", "1", png]);
  const sizes =
    id === "social"
      ? ([
          [1200, 630, "home-og"],
          [1280, 640, "github-social-preview"],
        ] as const)
      : ([[1200, 630, `${id}-1200x630`]] as const);
  for (const [width, height, name] of sizes)
    await run([
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-i",
      png,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0xfbfbf9`,
      "-frames:v",
      "1",
      join(output, `${name}.png`),
    ]);
}
await run([
  "ffmpeg",
  "-y",
  "-v",
  "error",
  "-ss",
  "14",
  "-i",
  join(output, "hero.mp4"),
  "-frames:v",
  "1",
  "-q:v",
  "3",
  join(output, "hero-poster.jpg"),
]);
console.log(`stills, social cards, and reveal poster: ${output}`);
async function run(command: string[]) {
  const process = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  if ((await process.exited) !== 0) throw new Error(`failed: ${command[0]}`);
}
