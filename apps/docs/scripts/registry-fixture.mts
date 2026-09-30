import { fileURLToPath } from "node:url";

// Resolve before entering the scratch directory; bunx there can select a different CLI.
export const shadcnCli = fileURLToPath(import.meta.resolve("shadcn"));

/** A fixed consumer baseline, with the DomainKit packages packed from the branch under test. */
export const registryManifest = (coreTarball: string, reactTarball: string) => {
  const dependencies = {
    "@base-ui/react": "1.8.0",
    "@domainkit/react": `file:${reactTarball}`,
    "@vitejs/plugin-react": "6.1.1",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "class-variance-authority": "0.7.1",
    clsx: "2.1.1",
    "lucide-react": "0.474.0",
    domainkit: `file:${coreTarball}`,
    effect: "4.0.0-rc.117",
    react: "19.2.4",
    "react-dom": "19.2.4",
    "tailwind-merge": "3.3.1",
    typescript: "7.0.2",
    vite: "8.2.2",
  };
  return {
    private: true,
    type: "module",
    scripts: { build: "vite build", typecheck: "tsc --noEmit" },
    dependencies,
    // The CLI adds each item's dependencies. Keep the consumer baseline and branch tarballs
    // even when it rewrites a dependency range in package.json.
    overrides: { ...dependencies },
  };
};
