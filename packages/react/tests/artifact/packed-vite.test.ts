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

describe("packed Vite consumer on React 19", () => {
  it("installs, bundles, and server-renders the public lifecycle", async () => {
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
            "@effect/atom-react": "4.0.0-rc.112",
            domainkit: `file:${coreTarball}`,
            effect: "4.0.0-rc.112",
            react: "19.2.4",
            "react-dom": "19.2.4",
            vite: "7.1.12",
          },
          overrides: { domainkit: `file:${coreTarball}` },
        }),
      );
      await run("bun", ["install"], directory);
      await writeFile(
        join(directory, "index.html"),
        '<div id="root"></div><script type="module" src="/main.jsx"></script>',
      );
      const consumer = `
import React from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Connection, Domain, DomainKit, Testing } from "@domainkit/react";

const transport = Testing.makeFakeTransport({
  inspect: {
    _tag: "Disconnected",
    domain: "mail.example.com",
    provider: Testing.provider(),
    reusableConnection: { connectionId: "connection-1", label: "existing account" },
  },
});
function CustomConnection() {
  const model = Connection.useModel("mail.example.com");
  const state = useAtomValue(model.state);
  const execute = useAtomSet(model.command);
  return React.createElement(
    "button",
    {
      "data-custom-atom": state._tag,
      onClick: () => execute(Connection.Command.Retry()),
      type: "button",
    },
    "Custom Atom state: " + state._tag,
  );
}
const app = React.createElement(
  DomainKit.Root,
  { transport },
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Domain.Flow, {
      domain: "mail.example.com",
      records: [{ id: "mx", type: "MX", name: "mail.example.com", value: "mx.example.net" }],
    }),
    React.createElement(CustomConnection),
  ),
);
export const html = renderToString(app);
if (typeof document !== "undefined") createRoot(document.getElementById("root")).render(app);
`;
      await writeFile(join(directory, "main.jsx"), consumer);
      await writeFile(
        join(directory, "ssr.mjs"),
        `${consumer}\nif (!html.includes("Detecting DNS provider") || !html.includes("Custom Atom state: Loading")) throw new Error("SSR Atom and recipe tracer did not render");`,
      );

      await run("bun", ["run", "vite", "build"], directory);
      await run("node", ["ssr.mjs"], directory);
      expect(await readFile(join(directory, "dist/index.html"), "utf8")).toContain(
        "/assets/index-",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 60_000);
});

describe("packed Next.js consumer", () => {
  it("builds and server-renders with React 19", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domainkit-react-next-consumer-"));
    try {
      const coreTarball = await pack(resolve("../domainkit"), directory);
      const reactTarball = await pack(resolve("."), directory);
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: "domainkit-react-next-consumer",
          private: true,
          scripts: { build: "next build" },
          dependencies: {
            "@domainkit/react": `file:${reactTarball}`,
            "@effect/atom-react": "4.0.0-rc.112",
            domainkit: `file:${coreTarball}`,
            effect: "4.0.0-rc.112",
            next: "15.5.7",
            react: "19.2.4",
            "react-dom": "19.2.4",
          },
          overrides: { domainkit: `file:${coreTarball}` },
        }),
      );
      await run("bun", ["install"], directory);
      await run("mkdir", ["-p", "app"], directory);
      await writeFile(
        join(directory, "app/layout.js"),
        `import "@domainkit/react/styles.css";
export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
      );
      await writeFile(
        join(directory, "app/page.js"),
        `"use client";
import { Connection, DomainKit, Testing } from "@domainkit/react";
const transport = Testing.makeFakeTransport({ inspect: { _tag: "Unsupported", domain: "example.com" } });
export default function Page() { return <DomainKit.Root transport={transport}><Connection.Flow domain="example.com" /></DomainKit.Root>; }`,
      );
      await run("bun", ["run", "build"], directory);
      expect(await readFile(join(directory, ".next/server/app/index.html"), "utf8")).toContain(
        "Detecting DNS provider",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 120_000);
});
