import { expect, test } from "@playwright/test";

for (const mode of ["light", "dark"] as const) {
  test(`${mode} connection dialog preserves keyboard and theme behavior`, async ({ page }) => {
    await page.goto(`/?mode=${mode}&theme=brand`);
    const trigger = page.getByRole("button", { name: "Connect", exact: true });
    await expect(trigger).toBeVisible();
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

test("workshop switches presentational stories from the sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Stories" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Stories" })
    .getByRole("button", { name: "Records" })
    .click();
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "MX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy zone" })).toBeVisible();
});
