import { expect, test } from "@playwright/test";

for (const mode of ["light", "dark"] as const) {
  test(`${mode} connection dialog preserves keyboard and theme behavior`, async ({ page }) => {
    await page.goto(`/?mode=${mode}&theme=brand`);
    const trigger = page.getByRole("button", { name: "Connect Cloudflare" });
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
