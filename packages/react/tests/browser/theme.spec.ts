import { expect, test } from "@playwright/test";

test("components catalog is organized by flows, components, and registry items", async ({
  page,
}) => {
  await page.goto("/components");
  await expect(page.locator("h1")).toHaveText("Components");
  const sidebar = page.getByRole("complementary", { name: "Primary" });
  await expect(sidebar.locator("p").filter({ hasText: /^Flows$/ })).toBeVisible();
  await expect(sidebar.locator("p").filter({ hasText: /^Components$/ })).toBeVisible();
  await expect(sidebar.locator("p").filter({ hasText: /^Registry$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connection", exact: true })).toHaveAttribute(
    "href",
    "/components/connection",
  );
  await expect(page.getByRole("link", { name: "Provider Mark", exact: true })).toHaveAttribute(
    "href",
    "/components/provider-mark",
  );
  await expect(page.getByRole("link", { name: "DNS table", exact: true })).toHaveAttribute(
    "href",
    "/components/registry/dns-table",
  );
});

test("component detail pages include a focused preview and usage sections", async ({ page }) => {
  await page.goto("/components/connection");
  await expect(page.getByRole("heading", { name: "Connection", exact: true })).toBeVisible();
  await expect(page.getByText("Interactive preview", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Installation/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Usage/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^API reference/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Code", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
});

test("focused previews support color modes and theme presets", async ({ page }) => {
  await page.goto("/components/provider-mark");
  const preview = page.locator("[data-component-preview]");
  await expect(preview).toHaveAttribute("data-scheme", "light");
  await preview.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(preview).toHaveAttribute("data-scheme", "dark");
  await expect(preview.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await preview.getByRole("combobox", { name: "Theme preset" }).selectOption("samva");
  await expect(preview).toHaveAttribute("data-theme", "samva");
});

test("connection preview keeps provider dialog accessible", async ({ page }) => {
  await page.goto("/components/connection");
  const trigger = page.getByRole("button", { name: "Connect", exact: true });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Connect Cloudflare" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("records page renders table and zone-file presentation", async ({ page }) => {
  await page.goto("/components/records");
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "MX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy zone" })).toBeVisible();
});
