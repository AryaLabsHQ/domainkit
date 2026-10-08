import { readFileSync, readdirSync } from "node:fs";

import {
  expect,
  test,
  type Frame,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * The production docs build, styled: every registry preview in its own frame and inside its docs
 * page. The behaviour suite in `tests/browser` has no Tailwind build, so hydration, clipping, and
 * wrapping at narrow widths are only observable here. Run `bun run build` first.
 */

const examples = readdirSync(new URL("../../examples/registry", import.meta.url))
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => file.replace(/\.tsx$/, ""))
  .sort();

const widths = [320, 375, 768, 1280] as const;

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element has no box on screen");
  return box;
};

/** A page, or an iframe inside one: the surface a preview is read from. */
type Scope = Page | FrameLocator;

const planActionBlocked = "Resolve the records above at your provider, then check again.";

/**
 * What each preview that renders past a grant or a request shows once it is real. Its island
 * clears `ssr` and mounts a wrapper before a connected preview has rendered anything, so the
 * wrapper alone does not mean the preview is there to be measured.
 */
const settled: Partial<Record<string, (scope: Scope) => Promise<void>>> = {
  "connect-dialog": async (scope) => {
    await expect(scope.getByRole("button", { name: "Connect" })).toBeVisible();
  },
  "disconnect-dialog": async (scope) => {
    await expect(scope.getByRole("button", { name: "Disconnect" })).toBeVisible();
  },
  "domain-field": async (scope) => {
    await expect(scope.getByRole("combobox")).toBeVisible();
  },
  "domain-flow": async (scope) => {
    await expect(scope.getByRole("button", { name: "Connect" })).toBeVisible();
    await expect(scope.getByRole("table")).toBeVisible();
  },
  outcome: async (scope) => {
    const alerts = scope.getByRole("alert");
    await expect(alerts).toHaveCount(2);
    await expect(alerts.first()).toContainText("Token not accepted");
    await expect(alerts.last()).toContainText("Token not accepted");
  },
  // Both connected rows: the action over the open plan, and the blocked row beneath it.
  "plan-action": async (scope) => {
    await expect(scope.getByRole("button", { name: "Add 3 records" })).toBeVisible();
    await expect(scope.getByText(planActionBlocked)).toBeVisible();
    await expect(scope.locator("[data-slot='provider-row']")).toContainText("Meridian");
  },
  "provider-row": async (scope) => {
    await expect(scope.getByRole("button", { name: "Connect" })).toBeVisible();
    await expect(scope.getByText("An administrator can connect Meridian")).toBeVisible();
  },
  "records-table": async (scope) => {
    await expect(scope.getByRole("button", { name: "Connect" })).toBeVisible();
    await expect(scope.getByRole("table")).toBeVisible();
  },
  "records-table-conflict": async (scope) => {
    await expect(scope.getByRole("button", { name: "Add 2 records" })).toHaveCount(2);
    await expect(scope.getByRole("table")).toBeVisible();
    await expect(scope.getByText("Conflict", { exact: true })).toBeVisible();
  },
};

/** Waits for the preview's island to hydrate and its own content to be on screen. */
const hydrated = async (scope: Scope, name: string) => {
  // An island that never hydrates keeps its `ssr` attribute, and a blank preview has no text.
  await expect(scope.locator("astro-island").first()).toBeAttached();
  await expect(scope.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(scope.locator("[data-blume-example]")).not.toBeEmpty();
  await expect(scope.locator("[data-blume-example] > *:not(style, script)").first()).toBeVisible();
  await settled[name]?.(scope);
};

const open = async (page: Page, name: string, width: number) => {
  await page.setViewportSize({ width, height: 800 });
  const response = await page.goto(`/blume-examples/registry/${name}/`);
  expect(response?.ok()).toBe(true);
  await hydrated(page, name);
};

/**
 * Elements whose box leaves the viewport or the box of an ancestor that clips it. Ellipsized text
 * clips by design, and a scroll container is itself checked, so its overflowing content is
 * reachable.
 */
const escaped = (target: Frame) =>
  target.evaluate(() => {
    const clips = (value: string) => value === "hidden" || value === "clip";
    const scrolls = (value: string) => value === "auto" || value === "scroll";
    const label = (element: Element) =>
      `${element.tagName.toLowerCase()}${element.getAttribute("data-slot") === null ? "" : `[${element.getAttribute("data-slot")}]`} "${(element.textContent ?? "").trim().slice(0, 40)}"`;
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      found.push(`page scrolls horizontally: ${root.scrollWidth} > ${root.clientWidth}`);
    }
    const frame = document.querySelector("[data-blume-example]");
    for (const element of frame?.querySelectorAll("*") ?? []) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const own = getComputedStyle(element);
      if (own.position === "absolute" || own.position === "fixed") continue;
      if (own.textOverflow === "ellipsis") continue;
      let reachable = false;
      let bounds = { left: 0, right: root.clientWidth };
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (scrolls(style.overflowX)) {
          reachable = true;
          break;
        }
        if (clips(style.overflowX)) {
          const parentBox = parent.getBoundingClientRect();
          bounds = {
            left: Math.max(bounds.left, parentBox.left),
            right: Math.min(bounds.right, parentBox.right),
          };
        }
        if (parent === frame) break;
      }
      if (reachable) continue;
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1) {
        found.push(
          `${label(element)} spans ${Math.round(box.left)}–${Math.round(box.right)}, inside ${Math.round(bounds.left)}–${Math.round(bounds.right)}`,
        );
      }
    }
    for (const element of frame?.querySelectorAll("*") ?? []) {
      const style = getComputedStyle(element);
      if (style.textOverflow === "ellipsis" || style.position === "absolute") continue;
      if (clips(style.overflowX) && element.scrollWidth > element.clientWidth + 1) {
        found.push(
          `${label(element)} hides ${element.scrollWidth - element.clientWidth}px of content`,
        );
      }
    }
    return found;
  });

for (const name of examples) {
  for (const width of widths) {
    test(`${name} hydrates and stays inside the frame at ${width}px`, async ({ page }, info) => {
      await open(page, name, width);
      expect(await escaped(page.mainFrame())).toEqual([]);
      await info.attach(`${name}-${width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
}

for (const width of widths) {
  test(`plan-action keeps both states readable and pressable at ${width}px`, async ({ page }) => {
    await open(page, "plan-action", width);
    const add = page.getByRole("button", { name: "Add 3 records" });
    await expect(add).toBeEnabled();
    await add.click({ trial: true });
    // The blocked row says what to fix, in full, beside the account it blocks.
    const blocked = page.getByText(planActionBlocked);
    await expect(blocked).toBeVisible();
    await expect(page.locator("[data-slot='provider-row']").last()).toContainText("Meridian");
    const box = await boxOf(blocked);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });

  test(`records-table-conflict names its conflict and offers its action at ${width}px`, async ({
    page,
  }) => {
    await open(page, "records-table-conflict", width);
    await expect(page.getByText("Conflict", { exact: true })).toBeVisible();
    await expect(page.getByText(/A CNAME cannot share a name/).locator("visible=true")).toHaveCount(
      1,
    );
    // The records card's header row and the action beneath it both offer the same press.
    const adds = page.getByRole("button", { name: "Add 2 records" });
    await expect(adds).toHaveCount(2);
    await expect(adds.first()).toBeEnabled();
    await adds.first().click({ trial: true });
    await expect(adds.last()).toBeEnabled();
    await adds.last().click({ trial: true });
  });

  test(`outcome shows the refusal in both layouts at ${width}px`, async ({ page }) => {
    await open(page, "outcome", width);
    const alerts = page.getByRole("alert");
    await expect(alerts).toHaveCount(2);
    await expect(alerts.first()).toBeVisible();
    await expect(alerts.last()).toBeVisible();
    await expect(alerts.first()).not.toBeEmpty();
    await expect(alerts.last()).not.toBeEmpty();
  });
}

// A docs page hosts each preview in an iframe; the page must not scroll sideways around them.
const dist = new URL("../../dist/", import.meta.url);
const pages = readdirSync(dist, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith("index.html") && !file.startsWith("blume-examples"))
  .flatMap((file) => {
    const sources = [
      ...readFileSync(new URL(file, dist), "utf8").matchAll(
        /<iframe[^>]*data-blume-example-frame[^>]*src="\/blume-examples\/registry\/([\w-]+)"/g,
      ),
    ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
    return sources.length === 0
      ? []
      : [{ frames: sources.length, route: `/${file.replace(/index\.html$/, "")}`, sources }];
  });

test("every registry preview is embedded by a docs page", () => {
  const embedded = new Set(pages.flatMap((page) => page.sources));
  expect(examples.filter((name) => !embedded.has(name))).toEqual([]);
});

for (const { frames, route, sources } of pages) {
  for (const width of [320, 375] as const) {
    for (let index = 0; index < frames; index += 1) {
      test(`${route} fits a ${width}px screen with preview ${index + 1} hydrated`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        const response = await page.goto(route);
        expect(response?.ok()).toBe(true);
        const host = page.locator("iframe[data-blume-example-frame]").nth(index);
        await host.scrollIntoViewIfNeeded();
        const name = sources[index];
        if (name === undefined) throw new Error(`${route} has no preview ${index + 1}`);
        await hydrated(page.frameLocator("iframe[data-blume-example-frame]").nth(index), name);
        const box = await boxOf(host);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        const overflow = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
        // The frame is narrower than the standalone page, so its own contents are checked too.
        const embedded = await (await host.elementHandle())?.contentFrame();
        if (embedded === null || embedded === undefined)
          throw new Error("The preview has no frame");
        expect(await escaped(embedded)).toEqual([]);
      });
    }
  }
}
