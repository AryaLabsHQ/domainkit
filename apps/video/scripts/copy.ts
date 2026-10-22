import { renderToStaticMarkup } from "react-dom/server";
import { markups } from "../src/scenes/markup";

/** Prints every visible text node for a frame-by-frame marketing truth audit. */
for (const [id, scene] of Object.entries(markups)) {
  const html = renderToStaticMarkup(scene.render());
  const strings = Array.from(
    new Set(
      Array.from(html.matchAll(/>([^<]+)</g), (match) =>
        (match[1] ?? "")
          .replaceAll("&amp;", "&")
          .replaceAll("&#x27;", "'")
          .replaceAll("&quot;", '"')
          .replaceAll("&gt;", ">")
          .replaceAll("&lt;", "<")
          .trim(),
      ).filter(Boolean),
    ),
  );
  console.log(JSON.stringify({ scene: id, strings }));
}
