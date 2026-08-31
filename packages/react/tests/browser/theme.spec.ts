import { expect, test } from "@playwright/test";

import { workshopTheme, workshopThemePresets } from "../../examples/vite/src/workshop-themes.ts";

for (const preset of workshopThemePresets) {
  for (const mode of ["light", "dark"] as const) {
    test(`${preset.label} reaches the DomainKit root in ${mode} mode`, async ({ page }) => {
      await page.goto(`/?mode=${mode}&theme=${preset.id}`);
      const accent = await page
        .locator("[data-domainkit-root]")
        .evaluate((root) => getComputedStyle(root).getPropertyValue("--domainkit-accent").trim());
      expect(accent).toBe(workshopTheme(preset.id, mode).accent);
    });
  }
}

for (const mode of ["light", "dark"] as const) {
  test(`${mode} connection dialog preserves keyboard and theme behavior`, async ({ page }) => {
    await page.goto(`/?mode=${mode}&theme=samva`);
    const trigger = page.getByRole("button", { name: "Connect", exact: true });
    await expect(trigger).toBeVisible();
    await expect(trigger.locator('[data-domainkit-part="provider-mark"]')).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Connect Cloudflare" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("border-radius", "12px");
    await expect(dialog.getByRole("button", { name: "Continue with OAuth" })).toHaveCSS(
      "background-color",
      "rgb(223, 122, 54)",
    );
    await expect(dialog.getByRole("button", { name: /Use Arya Labs/ })).not.toHaveCSS(
      "background-color",
      "rgb(223, 122, 54)",
    );
    const separator = dialog.getByRole("separator", { name: "or" });
    await expect(separator).toBeVisible();
    const separatorRules = await separator.evaluate((element) => ({
      after: getComputedStyle(element, "::after").borderTopWidth,
      before: getComputedStyle(element, "::before").borderTopWidth,
    }));
    expect(separatorRules).toEqual({ after: "1px", before: "1px" });
    const authenticationOrder = await dialog
      .locator(
        '[data-domainkit-part="provider-authentication"], [data-domainkit-part="authentication-separator"], [data-domainkit-part="token-connect"]',
      )
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-domainkit-part")),
      );
    expect(authenticationOrder).toEqual([
      "provider-authentication",
      "authentication-separator",
      "token-connect",
    ]);
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
  await page.goto("/?flow=lifecycle&theme=samva");
  await page.getByRole("button", { name: "Review changes" }).click();
  const plan = page.getByRole("dialog", { name: "Review changes" });
  await expect(plan).toBeVisible();
  await expect(plan.getByText(/Create MX mail.example.com/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Review changes" })).toBeFocused();

  const actions = page.getByRole("button", { name: "More connection actions" });
  await actions.click();
  await page.getByRole("menuitem", { name: "Remove records" }).click();
  const cleanup = page.getByRole("alertdialog", { name: "Remove records" });
  await expect(cleanup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
});

test("connected card geometry stays stable while success uses host notifications", async ({
  page,
}) => {
  await page.goto("/?flow=lifecycle&theme=samva");
  const card = page.locator('[data-domainkit-part="connected-card"]');
  await expect(card).toBeVisible();
  const before = await card.boundingBox();
  expect(before).not.toBeNull();

  await page.getByRole("button", { name: "Review changes" }).click();
  const plan = page.getByRole("dialog", { name: "Review changes" });
  await plan.getByRole("button", { name: "Add records" }).click();
  await expect(plan).toBeHidden();
  await expect(page.getByText("DNS changes applied")).toHaveCount(0);
  await expect(page.locator("[data-workshop-notification]")).toHaveText("DNS records added");

  const afterApply = await card.boundingBox();
  expect(afterApply).not.toBeNull();
  expect(Math.abs((afterApply?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1);
  expect(Math.abs((afterApply?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
  expect(Math.abs((afterApply?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(1);
  expect(Math.abs((afterApply?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(1);

  await page.getByRole("button", { name: "More connection actions" }).click();
  await page.getByRole("menuitem", { name: "Remove records" }).click();
  const cleanup = page.getByRole("alertdialog", { name: "Remove records" });
  await expect(cleanup).toBeVisible();
  await cleanup.getByRole("button", { name: "Remove records" }).click();
  await expect(cleanup).toBeHidden();
  await expect(page.getByText("DNS cleanup complete")).toHaveCount(0);
  await expect(page.locator("[data-workshop-notification]")).toHaveText("DNS records removed");
  await expect(page.getByRole("button", { name: "More connection actions" })).toBeFocused();

  const afterCleanup = await card.boundingBox();
  expect(afterCleanup).not.toBeNull();
  expect(Math.abs((afterCleanup?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(1);
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

test("reusable connections require an explicit target and never reconnect", async ({ page }) => {
  await page.goto("/?story=connection&theme=samva&targets=ambiguous");
  const trigger = page.getByRole("button", { name: "Connect", exact: true });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Connect Cloudflare" });
  const targetList = dialog.locator('[data-domainkit-part="target-list"]');
  await expect(targetList).toHaveAttribute("data-state", "ambiguous");
  await expect(dialog.locator('[data-domainkit-part="attach-target"]')).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: /Use Samva Team/ })).toBeVisible();

  await dialog.getByRole("button", { name: /Use Samva Team/ }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator('[data-domainkit-part="connection-status"][data-state="Connected"]'),
  ).toHaveText("Cloudflare connected");

  await page.goto("/?story=connection&theme=samva&targets=unavailable");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const unavailable = page
    .getByRole("dialog", { name: "Connect Cloudflare" })
    .locator('[data-domainkit-part="target-list"]');
  await expect(unavailable).toHaveAttribute("data-state", "unavailable");
  await expect(unavailable.locator('[data-domainkit-part="attach-target"]')).toHaveCount(0);
  await expect(unavailable).toContainText("No provider targets are available");
});

test("detaching the final attachment preserves its reusable target", async ({ page }) => {
  await page.goto("/?flow=lifecycle&theme=neutral");

  await page.getByRole("button", { name: "More connection actions" }).click();
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.locator('[data-domainkit-part="connection-status"]')).toHaveAttribute(
    "data-state",
    "Disconnected",
  );

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Cloudflare" });
  await expect(dialog.locator('[data-domainkit-part="target-list"]')).toHaveAttribute(
    "data-state",
    "unique",
  );
  await expect(dialog.getByRole("button", { name: /Use Arya Labs/ })).toBeVisible();
});

test("host-composed connection rows fill wide and narrow columns", async ({ page }) => {
  await page.goto("/?story=host-connection&theme=emerald");
  const triggers = page.getByRole("button", { name: "Connect Cloudflare" });
  await expect(triggers).toHaveCount(2);
  const wide = triggers.nth(0);
  await expect(wide).toHaveAttribute("data-workshop-host-button");
  await expect(wide).not.toHaveAttribute("data-domainkit-recipe");
  await expect(wide.locator('[data-domainkit-part="provider-mark"]')).toHaveCount(0);
  await expect(wide).toHaveCSS("background-color", "rgb(28, 140, 94)");
  await expect(page.locator("[data-workshop-host-row]").first()).toHaveCSS(
    "border-top-color",
    "rgb(216, 222, 219)",
  );
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
  const controls = page.getByRole("region", { name: "Workshop controls" });
  await expect(controls).toBeVisible();
  await expect(controls.getByText("Story", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Color scheme" })).toBeVisible();
  const theme = page.getByRole("combobox", { name: "Theme" });
  await expect(theme).toBeVisible();
  await theme.click();
  const themePopup = page.locator("[data-workshop-select-popup]");
  await expect(themePopup).toBeVisible();
  const menuFonts = await page.evaluate(() => {
    const popup = document.querySelector<HTMLElement>("[data-workshop-select-popup]");
    const trigger = document.querySelector<HTMLElement>("[data-workshop-select-trigger]");
    if (popup === null || trigger === null) throw new Error("Workshop theme controls are missing");
    const popupStyle = getComputedStyle(popup);
    return {
      background: popupStyle.backgroundColor,
      color: popupStyle.color,
      popup: getComputedStyle(popup).fontFamily,
      trigger: getComputedStyle(trigger).fontFamily,
    };
  });
  expect(menuFonts.background).toBe("rgb(255, 255, 255)");
  expect(menuFonts.color).toBe("rgb(24, 24, 27)");
  expect(menuFonts.popup).toBe(menuFonts.trigger);
  expect(menuFonts.popup).toContain("IBM Plex Sans");
  await page.keyboard.press("Escape");
  await expect(page.locator('.dialkit-panel[data-position="top-right"]')).toHaveCount(0);
  const paneBottoms = await page.evaluate(() => ({
    sidebar: document.querySelector("[data-workshop-sidebar]")?.getBoundingClientRect().bottom,
    workshop: document.querySelector("[data-workshop]")?.getBoundingClientRect().bottom,
  }));
  expect(paneBottoms.sidebar).toBe(paneBottoms.workshop);
  await page
    .getByRole("navigation", { name: "Stories" })
    .getByRole("button", { name: "Records" })
    .click();
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "MX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy zone" })).toBeVisible();
});

test("provider controls keep every dropdown option visible and selectable", async ({ page }) => {
  await page.goto("/?story=provider&mode=light&theme=samva");
  await page.getByRole("button", { name: "Provider Id Cloudflare", exact: true }).click();

  const route53 = page.getByRole("button", {
    name: "Amazon Route 53",
    exact: true,
  });
  await expect(route53).toBeVisible();
  const hitTarget = await route53.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      insideViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      receivesPointer: hit === element || element.contains(hit),
    };
  });
  expect(hitTarget).toEqual({ insideViewport: true, receivesPointer: true });
  await route53.click();

  await expect(page.getByRole("img", { name: "Amazon Route 53" })).toBeVisible();
  await expect(page.locator(".dialkit-text-input")).toHaveValue("Amazon Route 53");
});

test("DNS verification reports without moving its trigger", async ({ page }) => {
  await page.goto("/?story=lifecycle&theme=samva");
  await expect(page.getByRole("button", { name: "Add record" })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  const trigger = page.getByRole("button", { name: "Check DNS" });
  const frame = page.locator("[data-workshop-frame]");
  const before = await trigger.boundingBox();
  const frameBefore = await frame.boundingBox();
  expect(before).not.toBeNull();
  expect(frameBefore).not.toBeNull();

  await trigger.click();
  const results = page.locator('[data-domainkit-part="verification-popover"]');
  await expect(results).toBeVisible();
  await expect(results).toHaveAttribute("aria-label", "Check DNS");
  await expect(results.getByText("Provider")).toBeVisible();
  await expect(results.getByText("Public DNS")).toBeVisible();
  await expect(results.locator('[data-domainkit-part="verification-arrow"]')).toBeVisible();

  const popupGeometry = await results.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    width: element.getBoundingClientRect().width,
  }));
  expect(popupGeometry.width).toBeLessThanOrEqual(288);
  expect(popupGeometry.scrollWidth).toBe(popupGeometry.clientWidth);

  const after = await trigger.boundingBox();
  const frameAfter = await frame.boundingBox();
  expect(after).not.toBeNull();
  expect(frameAfter).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
  expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(1);
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(1);
  expect(Math.abs((frameAfter?.height ?? 0) - (frameBefore?.height ?? 0))).toBeLessThan(1);
});

test("standalone record cards retain neutral package tokens", async ({ page }) => {
  await page.goto("/?story=card");
  await expect(page.getByRole("button", { name: "Add record" })).toHaveCSS(
    "color",
    "rgb(24, 24, 27)",
  );
  await page.locator("[data-domainkit-root]").evaluate((root) => {
    root.removeAttribute("data-domainkit-root");
  });

  const card = page.locator('[data-domainkit-part="record-card"]').first();
  await expect(card).toHaveCSS("background-color", "rgb(244, 244, 245)");
  await expect(card).toHaveCSS("border-top-color", "rgb(212, 212, 216)");
});
