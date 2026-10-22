import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { app, launchDir } from "./projects";

const { values } = parseArgs({ options: { quality: { type: "string", default: "delivery" } } });
await mkdir(join(app, "renders"), { recursive: true });
const output = join(app, "renders/hero.mp4");
const render = Bun.spawn(
  [
    join(app, "node_modules/.bin/hyperframes"),
    "render",
    launchDir,
    "--quality",
    values.quality,
    "--output",
    output,
    "--quiet",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await render.exited) !== 0) throw new Error("hero render failed");
// Leave AAC encoding headroom after the bed's separate gain/fade pass; copy the picture.
const probe = Bun.spawnSync([
  "ffprobe",
  "-v",
  "error",
  "-select_streams",
  "a",
  "-show_entries",
  "stream=index",
  "-of",
  "csv=p=0",
  output,
]);
if (!probe.success) throw new Error(probe.stderr.toString());
if (probe.stdout.toString().trim() !== "") {
  const mastered = join(app, "renders/hero.master.mp4");
  const master = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-i",
      output,
      "-c:v",
      "copy",
      "-af",
      "loudnorm=I=-14:TP=-2:LRA=11,aformat=sample_rates=48000",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      mastered,
    ],
    { stderr: "pipe" },
  );
  const error = await new Response(master.stderr).text();
  if ((await master.exited) !== 0) throw new Error(`mastering hero: ${error}`);
  await rename(mastered, output);
}
console.log(`rendered ${output}`);
