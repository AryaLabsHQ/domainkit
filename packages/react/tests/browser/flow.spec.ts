import { expect, test } from "@playwright/test";

/** Screenshots land in the gitignored Playwright output directory, for PR review. */
const shot = (name: string) => `test-results/screenshots/${name}.png`;

/** A zone per test keeps the fixture's fake provider from seeing another test's records. */
const open = async (page: import("@playwright/test").Page, zone: string, scheme = "light") => {
  await page.goto(`/?zone=${zone}&scheme=${scheme}`);
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
};

test("renders the requirements table and the connect action", async ({ page }) => {
  await open(page, "browser1.example");
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "CNAME" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "TXT" })).toBeVisible();
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("flow") });
});

test("opens the connect dialog and renders the provider's declared token field", async ({
  page,
}) => {
  await open(page, "browser2.example");
  await page.getByRole("button", { name: "Connect" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Sign in (fake)" })).toBeVisible();
  const field = dialog.getByLabel("Token");
  await expect(field).toHaveAttribute("type", "password");
  await dialog.screenshot({ path: shot("connect-dialog") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Connect" })).toBeFocused();
});

test("connects, reviews the plan, and approves it", async ({ page }) => {
  await open(page, "browser3.example");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("dialog").getByLabel("Token").fill("secret-token");
  await page.getByRole("button", { name: "Token (fake)" }).click();
  await expect(page.getByText("fake connected")).toBeVisible();

  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
  await page
    .locator("[data-domainkit-part='domain-flow']")
    .screenshot({ path: shot("plan-review") });
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("DNS records added.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove records" })).toBeVisible();
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("applied") });
});

test("takes theme tokens and the color scheme from the root", async ({ page }) => {
  await open(page, "browser4.example", "dark");
  const root = page.locator("[data-domainkit-root]").first();
  await expect(root).toHaveAttribute("data-color-scheme", "dark");
  await expect(root).toHaveCSS("--domainkit-accent", "#4f46e5");
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("dark") });
});
