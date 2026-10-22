import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { renderToStaticMarkup } from "react-dom/server";
import { hero, stillIds } from "../src/cuts";
import type { Cut } from "../src/scene";
import { markups } from "../src/scenes/markup";
import { scoreMusic } from "./music";
import { app, launchDir, stillDir } from "./projects";

const { values } = parseArgs({ options: { scene: { type: "string" } } });
const runtime = await Bun.build({
  entrypoints: [join(app, "src/runtime.ts")],
  format: "iife",
  target: "browser",
});
const [bundle] = runtime.outputs;
if (!runtime.success || bundle === undefined)
  throw new AggregateError(runtime.logs, "motion bundle failed");
const tailwind = Bun.spawn(
  [join(app, "node_modules/.bin/tailwindcss"), "-i", join(app, "src/styles.css")],
  { cwd: app, stdout: "pipe", stderr: "pipe" },
);
const [css, warnings, cssCode] = await Promise.all([
  new Response(tailwind.stdout).text(),
  new Response(tailwind.stderr).text(),
  tailwind.exited,
]);
if (cssCode !== 0) throw new Error(`Tailwind: ${warnings}`);
const systemFallbacks = [
  "SFMono-Regular",
  "Apple Color Emoji",
  "Segoe UI Emoji",
  "Segoe UI Symbol",
];
const stylesheet =
  css.replace(/^\s*(?:transition|animation)(?:-[a-z-]+)?\s*:[^;{}]*;\s*$/gm, "") +
  systemFallbacks
    .map((family) => `\n@font-face { font-family: "${family}"; src: local("${family}"); }`)
    .join("");
const js = await bundle.text();
const config = await readFile(join(launchDir, "hyperframes.json"), "utf8");

if (values.scene !== undefined) {
  const id = values.scene;
  if (markups[id] === undefined) throw new Error(`unknown scene ${id}`);
  const source = hero.shots.find((shot) => shot.scene === id);
  await project(
    {
      id: `scene-${id}`,
      width: 1920,
      height: 1080,
      shots: [{ scene: id, start: 0, duration: source?.duration ?? 4 }],
    },
    join(app, ".build/scenes", id),
  );
} else {
  await project(hero, launchDir);
  await Promise.all(
    stillIds.map((id) =>
      project(
        {
          id: `still-${id}`,
          width: 1920,
          height: 1080,
          shots: [{ scene: id, start: 0, duration: 3 }],
        },
        stillDir(id),
      ),
    ),
  );
}

async function project(cut: Cut, dir: string) {
  const assets = join(dir, "assets");
  await mkdir(join(assets, "fonts"), { recursive: true });
  await mkdir(join(dir, "compositions"), { recursive: true });
  await Promise.all([
    writeFile(join(assets, "domainkit.css"), stylesheet),
    writeFile(join(assets, "scenes.js"), js),
    copyFile(join(app, "node_modules/gsap/dist/gsap.min.js"), join(assets, "gsap.min.js")),
    copyFile(
      join(app, "../docs/public/brand/domainkit-mark.svg"),
      join(assets, "domainkit-mark.svg"),
    ),
    copyFile(
      join(app, "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
      join(assets, "fonts/geist-latin.woff2"),
    ),
    copyFile(
      join(
        app,
        "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
      ),
      join(assets, "fonts/geist-mono-latin.woff2"),
    ),
    ...(dir === launchDir ? [] : [writeFile(join(dir, "hyperframes.json"), config)]),
  ]);
  const duration = Math.max(...cut.shots.map((shot) => shot.start + shot.duration));
  const music = cut.music === true ? await scoreMusic(duration, assets) : undefined;
  const hosts = await Promise.all(
    cut.shots.map(async (shot, index) => {
      const markup = markups[shot.scene];
      if (markup === undefined) throw new Error(`unknown scene ${shot.scene}`);
      const id = `${cut.id}-${index}-${shot.scene}`;
      await writeFile(
        join(dir, "compositions", `${id}.html`),
        `<!doctype html><html><head><meta charset="UTF-8"></head><body><template>
      <div data-composition-id="${id}" data-width="${cut.width}" data-height="${cut.height}" style="position:absolute;inset:0">${renderToStaticMarkup(markup.render())}</div>
      <script>window.__timelines=window.__timelines||{};window.__timelines[${JSON.stringify(id)}]=domainkitVideo.scene(${JSON.stringify(shot.scene)},${JSON.stringify(id)});</script>
      </template></body></html>`,
      );
      return `<div id="${id}-host" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${shot.start}" data-duration="${shot.duration}" data-track-index="0" data-width="${cut.width}" data-height="${cut.height}"></div>`;
    }),
  );
  await writeFile(
    join(dir, "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${cut.width},height=${cut.height}">
    <link rel="stylesheet" href="assets/domainkit.css"><style>html,body{margin:0;width:${cut.width}px;height:${cut.height}px;overflow:hidden;background:var(--blume-background)}#root{position:relative;width:${cut.width}px;height:${cut.height}px}</style>
    <script src="assets/gsap.min.js"></script><script src="assets/scenes.js"></script></head><body>
    <div id="root" data-composition-id="${cut.id}" data-start="0" data-duration="${duration}" data-width="${cut.width}" data-height="${cut.height}">${hosts.join("\n")}${music === undefined ? "" : `<audio id="music" src="${music}" data-start="0" data-duration="${duration}" data-track-index="1"></audio>`}</div>
    <script>window.__timelines=window.__timelines||{};window.__timelines[${JSON.stringify(cut.id)}]=gsap.timeline({paused:true});</script></body></html>`,
  );
  console.log(`built ${cut.id} (${duration}s) at ${dir}`);
}
