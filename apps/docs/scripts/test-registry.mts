import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = join(root, "public", "r");
const names = [
  "dns-table",
  "dns-operation",
  "dns-status",
  "provider-mark",
  "copy-value",
  "async-state",
] as const;

await Promise.all(
  names.map(async (name) => {
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
const run = async (...command: ReadonlyArray<string>) => {
  const child = Bun.spawn(command, { cwd: fixture, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with ${exitCode}`);
};

try {
  await mkdir(join(fixture, "src"), { recursive: true });
  await Bun.write(
    join(fixture, "package.json"),
    JSON.stringify({
      private: true,
      scripts: { build: "vite build", typecheck: "tsc --noEmit" },
      dependencies: {
        "@vitejs/plugin-react": "6.1.1",
        "@types/react": "19.2.18",
        "@types/react-dom": "19.2.5",
        react: "19.2.4",
        "react-dom": "19.2.4",
        typescript: "7.0.2",
        vite: "8.2.2",
      },
    }),
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
      style: "new-york",
      tailwind: { baseColor: "neutral", config: "", css: "src/index.css", cssVariables: true },
      tsx: true,
    }),
  );
  await Bun.write(
    join(fixture, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        lib: ["ES2023", "DOM"],
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        paths: { "@/*": ["./src/*"] },
        strict: true,
        target: "ES2023",
      },
      include: ["src"],
    }),
  );
  await Bun.write(
    join(fixture, "index.html"),
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  );
  await Bun.write(join(fixture, "src/index.css"), "");
  await Bun.write(
    join(fixture, "src/main.tsx"),
    `import { createRoot } from "react-dom/client";
import { ErrorState } from "@/components/ui/async-state";
import { CopyValue } from "@/components/ui/copy-value";
import { DnsOperation } from "@/components/ui/dns-operation";
import { DnsStatus } from "@/components/ui/dns-status";
import { DnsTable } from "@/components/ui/dns-table";
import { ProviderMark } from "@/components/ui/provider-mark";

const record = { id: "mx", name: "mail.example.com", type: "MX", value: "mx.example.net" };
createRoot(document.getElementById("root")!).render(
  <main>
    <ProviderMark label="Example DNS"><span>E</span></ProviderMark>
    <DnsTable records={[{ ...record, status: <DnsStatus tone="success">Found</DnsStatus> }]} />
    <DnsOperation action="Create" {...record} />
    <CopyValue value={record.value} />
    <ErrorState>Provider unavailable</ErrorState>
  </main>,
);
`,
  );
  await run("bun", "install");
  await run(
    "bunx",
    "shadcn",
    "add",
    ...names.map((name) => join(output, `${name}.json`)),
    "--yes",
    "--overwrite",
  );
  await run("bun", "run", "typecheck");
  await run("bun", "run", "build");
} finally {
  await rm(fixture, { force: true, recursive: true });
}
