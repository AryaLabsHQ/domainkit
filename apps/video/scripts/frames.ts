import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "./projects";

const checkpoints = [
  [2.5, "hook-copy"],
  [5.5, "hook-paste"],
  [8, "hook"],
  [14, "reveal"],
  [21, "connect"],
  [30, "plan"],
  [36, "approve"],
  [39.5, "receipt"],
  [45, "verify"],
  [53, "boundary"],
  [58, "cta"],
] as const;
const dir = join(app, ".build/review");
await mkdir(dir, { recursive: true });
const files = await Promise.all(
  checkpoints.map(async ([time, id]) => {
    const file = join(dir, `${id}.png`);
    await run([
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-ss",
      String(time),
      "-i",
      join(app, "renders/hero.mp4"),
      "-frames:v",
      "1",
      file,
    ]);
    return file;
  }),
);
const cells = checkpoints.map(
  (_, index) => `[${index}:v]scale=480:270,pad=480:300:0:0:color=0xfbfbf9[v${index}]`,
);
const layout = checkpoints
  .map((_, index) => `${(index % 4) * 480}_${Math.floor(index / 4) * 300}`)
  .join("|");
const graph = `${cells.join(";")};${checkpoints.map((_, index) => `[v${index}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=0xfbfbf9[out]`;
await run([
  "ffmpeg",
  "-y",
  "-v",
  "error",
  ...files.flatMap((file) => ["-i", file]),
  "-filter_complex",
  graph,
  "-map",
  "[out]",
  "-frames:v",
  "1",
  join(dir, "contact-sheet.png"),
]);
console.log(`MP4 frames and contact sheet: ${dir}`);
async function run(command: string[]) {
  const process = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  if ((await process.exited) !== 0) throw new Error(`frame export failed: ${command[0]}`);
}
