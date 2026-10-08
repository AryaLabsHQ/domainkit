import { join, normalize } from "node:path";

/**
 * Serves the production docs build (`dist`) for the styled browser run. A directory resolves to its
 * `index.html`, the way the deployed static site does; nothing is rewritten or proxied.
 */
const root = join(import.meta.dirname, "../dist");
const port = Number(process.env.DOMAINKIT_STYLED_PORT ?? "4322");

const resolveFile = async (pathname: string) => {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const target = join(root, relative);
  if (!target.startsWith(root)) return null;
  const files = [Bun.file(target), Bun.file(join(target, "index.html"))];
  const found = await Promise.all(files.map((file) => file.exists()));
  return files.find((_, index) => found[index]) ?? null;
};

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const file = await resolveFile(new URL(request.url).pathname);
    return file === null ? new Response("Not found", { status: 404 }) : new Response(file);
  },
});
console.log(`Serving ${root} on http://127.0.0.1:${port}`);
