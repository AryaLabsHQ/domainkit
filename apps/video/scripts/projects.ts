import { join, resolve } from "node:path";
export const app = resolve(import.meta.dir, "..");
export const launchDir = join(app, "launches/introducing-domainkit");
export const outputDir = join(app, "../docs/public/launch");
export const stillDir = (id: string) => join(app, ".build/stills", id);
