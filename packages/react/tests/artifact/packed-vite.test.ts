import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const run = async (command: string, args: ReadonlyArray<string>, cwd: string) =>
  execFileAsync(command, args, { cwd, env: process.env });

const pack = async (packageDirectory: string, destination: string): Promise<string> => {
  const before = new Set(await readdir(destination));
  await run("bun", ["pm", "pack", "--destination", destination], packageDirectory);
  const after = await readdir(destination);
  const filename = after.find((candidate) => candidate.length > 0 && !before.has(candidate));
  if (filename === undefined) throw new Error(`Packing ${packageDirectory} produced no artifact`);
  return join(destination, filename);
};

describe("packed Vite consumer", () => {
  it("installs, bundles, and server-renders the public connection tracer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domainkit-react-consumer-"));
    try {
      const coreTarball = await pack(resolve("../domainkit"), directory);
      const reactTarball = await pack(resolve("."), directory);

      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: "domainkit-react-packed-consumer",
          private: true,
          type: "module",
          dependencies: {
            "@domainkit/react": `file:${reactTarball}`,
            domainkit: `file:${coreTarball}`,
            react: "19.2.4",
            "react-dom": "19.2.4",
            vite: "7.1.12",
          },
        }),
      );
      await run("bun", ["install"], directory);
      await writeFile(
        join(directory, "index.html"),
        '<div id="root"></div><script type="module" src="/main.jsx"></script>',
      );
      const consumer = `
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Connection, DomainKit, Testing } from "@domainkit/react";

const transport = Testing.makeFakeTransport({
  inspect: {
    _tag: "Disconnected",
    domain: "mail.example.com",
    provider: Testing.provider(),
    reusableConnection: { connectionId: "connection-1", label: "existing account" },
  },
});
const app = React.createElement(
  DomainKit.Root,
  { transport },
  React.createElement(Connection.Flow, { domain: "mail.example.com" }),
);
export const html = renderToString(app);
if (typeof document !== "undefined") createRoot(document.getElementById("root")).render(app);
`;
      await writeFile(join(directory, "main.jsx"), consumer);
      await writeFile(
        join(directory, "ssr.mjs"),
        `${consumer}\nif (!html.includes("Detecting DNS provider")) throw new Error("SSR tracer did not render");`,
      );

      await run("bun", ["run", "vite", "build"], directory);
      await run("node", ["ssr.mjs"], directory);
      expect(await readFile(join(directory, "dist/index.html"), "utf8")).toContain(
        "/assets/index-",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);
});
