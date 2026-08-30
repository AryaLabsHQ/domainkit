import { expect, test } from "@playwright/test";

for (const mode of ["light", "dark"] as const) {
  test(`${mode} connection dialog preserves keyboard and theme behavior`, async ({ page }) => {
    await page.goto(`/?mode=${mode}&theme=brand`);
    const trigger = page.getByRole("button", { name: "Connect", exact: true });
    await expect(trigger).toBeVisible();
    await expect(trigger.locator('[data-domainkit-part="provider-mark"]')).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Connect Cloudflare" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("border-radius", "16px");
    await expect(dialog.getByRole("button", { name: "Continue with OAuth" })).toHaveCSS(
      "background-color",
      "rgb(124, 58, 237)",
    );
    await expect(dialog.getByRole("button", { name: "Use Arya Labs account" })).not.toHaveCSS(
      "background-color",
      "rgb(124, 58, 237)",
    );
    await expect(dialog.getByRole("img", { name: "Cloudflare" })).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test("provisioning and cleanup dialogs preserve review focus", async ({ page }) => {
  await page.goto("/?flow=lifecycle&theme=brand");
  await page.getByRole("button", { name: "Review changes" }).click();
  const plan = page.getByRole("dialog", { name: "Review changes" });
  await expect(plan).toBeVisible();
  await expect(plan.getByText(/Create MX mail.example.com/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Review changes" })).toBeFocused();

  await page.getByRole("button", { name: "Remove records" }).click();
  const cleanup = page.getByRole("dialog", { name: "Remove records" });
  await expect(cleanup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Remove records" })).toBeFocused();
});

test("connection recipe fills the workshop column", async ({ page }) => {
  await page.goto("/");
  const root = page.locator('[data-domainkit-part="connection-root"]');
  await expect(root).toBeVisible();
  const trigger = page.getByRole("button", { name: "Connect", exact: true });
  await expect(trigger).toHaveAttribute("data-domainkit-recipe", "connect");
  await expect(page.getByText("Cloudflare manages DNS for this domain")).toBeVisible();
  const delta = await page.evaluate(() => {
    const frameBox = document.querySelector("[data-workshop-frame]")?.getBoundingClientRect();
    const rootBox = document
      .querySelector('[data-domainkit-part="connection-root"]')
      ?.getBoundingClientRect();
    if (frameBox === undefined || rootBox === undefined) return Number.POSITIVE_INFINITY;
    return Math.abs(frameBox.width - rootBox.width);
  });
  expect(delta).toBeLessThan(1);
});

test("host-composed connection rows fill wide and narrow columns", async ({ page }) => {
  await page.goto("/?story=host-connection&theme=brand");
  const triggers = page.getByRole("button", { name: "Connect Cloudflare" });
  await expect(triggers).toHaveCount(2);
  const wide = triggers.nth(0);
  await expect(wide).toHaveAttribute("data-workshop-host-button");
  await expect(wide).not.toHaveAttribute("data-domainkit-recipe");
  await expect(wide.locator('[data-domainkit-part="provider-mark"]')).toHaveCount(0);
  await expect(wide).toHaveCSS("background-color", "rgb(24, 24, 27)");
  await wide.click();
  await expect(page.getByRole("dialog", { name: "Connect Cloudflare" })).toBeVisible();
  await page.keyboard.press("Escape");

  const widths = await page.evaluate(() => {
    const frame = document.querySelector("[data-workshop-frame]")?.getBoundingClientRect();
    const rows = [...document.querySelectorAll("[data-workshop-host-row]")].map((row) =>
      row.getBoundingClientRect(),
    );
    const narrow = document.querySelector("[data-workshop-narrow]")?.getBoundingClientRect();
    return {
      frame: frame?.width,
      wide: rows[0]?.width,
      narrowRow: rows[1]?.width,
      narrow: narrow?.width,
    };
  });
  expect(widths.frame).toBeDefined();
  expect(widths.wide).toBeDefined();
  expect(Math.abs((widths.frame ?? 0) - (widths.wide ?? 0))).toBeLessThan(1);
  expect(Math.abs((widths.narrow ?? 0) - (widths.narrowRow ?? 0))).toBeLessThan(1);
  expect(widths.narrow).toBeLessThan(widths.frame ?? 0);
});

test("workshop switches presentational stories from the sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Stories" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Controls" }).locator(".dialkit-root"),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Stories" })
    .getByRole("button", { name: "Records" })
    .click();
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "MX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy zone" })).toBeVisible();
});

test("standalone record cards retain neutral package tokens", async ({ page }) => {
  await page.goto("/?story=card");
  await page.locator("[data-domainkit-root]").evaluate((root) => {
    root.removeAttribute("data-domainkit-root");
  });

  const card = page.locator('[data-domainkit-part="record-card"]').first();
  await expect(card).toHaveCSS("background-color", "rgb(244, 244, 245)");
  await expect(card).toHaveCSS("border-top-color", "rgb(212, 212, 216)");
});
