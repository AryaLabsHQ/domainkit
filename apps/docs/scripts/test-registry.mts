import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const workspace = resolve(root, "..", "..");
const output = join(root, "public", "r");

/** The plain display items: props in, markup out, and no DomainKit runtime behind them. */
const display = [
  "dns-table",
  "dns-operation",
  "dns-status",
  "provider-mark",
  "copy-value",
  "async-state",
] as const;

/** The flow items, which are written against `@domainkit/react` and the host's own kit. */
const flow = [
  "outcome",
  "plan-action",
  "records-table",
  "disconnect-dialog",
  "connect-dialog",
  "provider-row",
  "domain-field",
  "domain-flow",
] as const;

await Promise.all(
  display.map(async (name) => {
    const item = JSON.parse(await readFile(join(output, `${name}.json`), "utf8")) as {
      readonly files: ReadonlyArray<{ readonly content: string }>;
    };
    const imports = item.files.flatMap((file) =>
      new Bun.Transpiler({ loader: "tsx" }).scanImports(file.content),
    );
    const forbidden = imports.find(
      ({ path }) => path === "domainkit" || path === "effect" || path.startsWith("@effect/"),
    );
    if (forbidden !== undefined) {
      throw new Error(`${name} imports the managed runtime through ${forbidden.path}`);
    }
  }),
);

const fixture = await mkdtemp(join(tmpdir(), "domainkit-registry-"));
const run = async (...command: string[]) => {
  const child = Bun.spawn(command, { cwd: fixture, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with ${exitCode}`);
};

/** Pack a workspace package so the scratch project compiles against this branch, not the release. */
const pack = async (directory: string): Promise<string> => {
  const before = new Set(await readdir(fixture));
  const child = Bun.spawn(["bun", "pm", "pack", "--destination", fixture], {
    cwd: directory,
    stderr: "inherit",
    stdout: "ignore",
  });
  if ((await child.exited) !== 0) throw new Error(`Packing ${directory} failed`);
  const packed = (await readdir(fixture)).find((entry) => !before.has(entry));
  if (packed === undefined) throw new Error(`Packing ${directory} produced no artifact`);
  return join(fixture, packed);
};

try {
  await mkdir(join(fixture, "src", "lib"), { recursive: true });
  const coreTarball = await pack(join(workspace, "packages", "domainkit"));
  const reactTarball = await pack(join(workspace, "packages", "react"));
  const dependencies = {
    "@base-ui/react": "^1.7.0",
    "@domainkit/react": `file:${reactTarball}`,
    "@vitejs/plugin-react": "6.1.1",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "class-variance-authority": "0.7.1",
    clsx: "2.1.1",
    "lucide-react": "0.474.0",
    domainkit: `file:${coreTarball}`,
    effect: "4.0.0-rc.112",
    react: "19.2.4",
    "react-dom": "19.2.4",
    "tailwind-merge": "3.3.1",
    typescript: "7.0.2",
    vite: "8.2.2",
  };
  const manifest = {
    private: true,
    type: "module",
    scripts: { build: "vite build", typecheck: "tsc --noEmit" },
    dependencies,
    // The CLI installs each item's declared dependencies, which would fetch the published
    // DomainKit; the overrides keep the scratch project on the packed branch instead.
    overrides: {
      "@domainkit/react": `file:${reactTarball}`,
      domainkit: `file:${coreTarball}`,
    },
  };
  await Bun.write(join(fixture, "package.json"), JSON.stringify(manifest));
  await Bun.write(
    join(fixture, "src", "lib", "utils.ts"),
    `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ReadonlyArray<ClassValue>) {
  return twMerge(clsx(inputs));
}
`,
  );
  await Bun.write(
    join(fixture, "components.json"),
    JSON.stringify({
      $schema: "https://ui.shadcn.com/schema.json",
      aliases: {
        components: "@/components",
        hooks: "@/hooks",
        lib: "@/lib",
        ui: "@/components/ui",
        utils: "@/lib/utils",
      },
      iconLibrary: "lucide",
      rsc: false,
      // The flow is written on the Base UI idiom: components take `render`, not `asChild`.
      style: "base-nova",
      tailwind: { baseColor: "neutral", config: "", css: "src/index.css", cssVariables: true },
      tsx: true,
    }),
  );
  await Bun.write(
    join(fixture, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        lib: ["ESNext", "DOM"],
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        paths: { "@/*": ["./src/*"] },
        strict: true,
        target: "ESNext",
      },
      include: ["src"],
    }),
  );
  await Bun.write(
    join(fixture, "vite.config.ts"),
    `import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
});
`,
  );
  await Bun.write(
    join(fixture, "index.html"),
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  );
  await Bun.write(join(fixture, "src/index.css"), "");
  await Bun.write(
    join(fixture, "src/main.tsx"),
    `import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { DomainKit } from "@domainkit/react";
import { createRoot } from "react-dom/client";
import { ErrorState } from "@/components/ui/async-state";
import { CopyValue } from "@/components/ui/copy-value";
import { DnsOperation } from "@/components/ui/dns-operation";
import { DnsStatus } from "@/components/ui/dns-status";
import { DnsTable } from "@/components/ui/dns-table";
import { ProviderMark } from "@/components/ui/provider-mark";
import { DomainField } from "@/components/domainkit/domain-field";
import { DomainFlow } from "@/components/domainkit/domain-flow";

const record = { id: "cname", name: "app.example.com", type: "CNAME", value: "edge.acme.dev" };
const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
];
const transport = Transport.fromFetch("/api/domainkit");

createRoot(document.getElementById("root")!).render(
  <main>
    <ProviderMark label="Cloudflare">
      <img alt="" height={32} src="https://integrations.sh/logo/cloudflare.com?sz=64" width={32} />
    </ProviderMark>
    <DnsTable records={[{ ...record, purpose: "Serve your site", status: <DnsStatus status="satisfied" /> }]} />
    <DnsOperation operation="create" {...record} />
    <CopyValue value={record.value} />
    <ErrorState>Provider unavailable</ErrorState>
    <DomainKit.Root transport={transport}>
      <DomainFlow domain="app.example.com" requirements={requirements} />
      <DomainField onChange={() => {}} value="" />
    </DomainKit.Root>
  </main>,
);
`,
  );

  // The published items point at each other by URL, which would reach the live site rather than
  // this branch. Every item is on the command line already, so the copies the check installs drop
  // those cross-references and keep the shadcn primitives each one needs.
  const local = join(fixture, "registry");
  await mkdir(local, { recursive: true });
  await Promise.all(
    [...display, ...flow].map(async (name) => {
      const item = JSON.parse(await readFile(join(output, `${name}.json`), "utf8")) as {
        registryDependencies?: ReadonlyArray<string>;
      };
      const kept = (item.registryDependencies ?? []).filter(
        (entry) => !entry.startsWith("https://domain-kit.dev/r/"),
      );
      await Bun.write(
        join(local, `${name}.json`),
        JSON.stringify({ ...item, registryDependencies: kept }),
      );
    }),
  );

  await run("bun", "install");
  await run(
    "bunx",
    "shadcn",
    "add",
    ...[...display, ...flow].map((name) => join(local, `${name}.json`)),
    "--yes",
    "--overwrite",
  );
  // The CLI's own install may have moved the workspace packages back to the registry versions.
  await run("bun", "install");
  await run("bun", "run", "typecheck");
  await run("bun", "run", "build");
} finally {
  await rm(fixture, { force: true, recursive: true });
}
