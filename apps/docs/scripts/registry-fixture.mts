import { fileURLToPath } from "node:url";

// Resolve before entering the scratch directory; bunx there can select a different CLI.
export const shadcnCli = fileURLToPath(import.meta.resolve("shadcn"));

/** An initial consumer baseline, with DomainKit packed from the branch under test. */
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
    effect: "4.0.0",
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
    // Only the packages under test override resolution. Live registry primitives keep their
    // own transitive requirements instead of inheriting the fixture's direct dependency pins.
    overrides: {
      "@domainkit/react": dependencies["@domainkit/react"],
      domainkit: dependencies.domainkit,
    },
  };
};
