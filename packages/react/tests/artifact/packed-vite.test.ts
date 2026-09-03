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

/** What a host actually writes: a fetch transport and the two components. */
const consumerSource = `
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { Domain, DomainKit } from "@domainkit/react";

const transport = Transport.fromFetch("/api/domainkit");
const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.example.com", purpose: "Serve your site" }),
];
const app = React.createElement(
  DomainKit.Root,
  { transport },
  React.createElement(Domain.Flow, { domain: "app.example.com", requirements }),
);
export const html = renderToString(app);
if (typeof document !== "undefined") createRoot(document.getElementById("root")).render(app);
`;

describe("packed Vite consumer on React 19", () => {
  it("installs, bundles, and server-renders the public flow", async () => {
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
      await writeFile(join(directory, "main.jsx"), consumerSource);
      await writeFile(
        join(directory, "ssr.mjs"),
        `${consumerSource}
if (!html.includes("app.example.com") || !html.includes("CNAME")) {
  throw new Error("The server render did not include the requirements table");
}`,
      );

      await run("bun", ["run", "vite", "build"], directory);
      await run("node", ["ssr.mjs"], directory);
      expect(await readFile(join(directory, "dist/index.html"), "utf8")).toContain(
        "/assets/index-",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 120_000);
});

describe("packed Next.js consumer", () => {
  it("builds an App Router page against the packed client entry", async () => {
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
      // The transport is an object of functions, so it cannot cross the server/client boundary:
      // a host builds it inside a client module. The packed entry carries "use client" itself, so
      // the server component below imports it without any extra wrapper.
      await writeFile(
        join(directory, "app/domain-settings.js"),
        `"use client";
import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { Domain, DomainKit } from "@domainkit/react";

const transport = Transport.fromFetch("/api/domainkit");
const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.example.com", purpose: "Serve your site" }),
];

export function DomainSettings() {
  return (
    <DomainKit.Root transport={transport}>
      <Domain.Flow domain="app.example.com" requirements={requirements} />
    </DomainKit.Root>
  );
}`,
      );
      await writeFile(
        join(directory, "app/page.js"),
        `import { DomainSettings } from "./domain-settings";

export default function Page() { return <DomainSettings />; }`,
      );
      await run("bun", ["run", "build"], directory);
      expect(await readFile(join(directory, ".next/server/app/index.html"), "utf8")).toContain(
        "app.example.com",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 240_000);
});
