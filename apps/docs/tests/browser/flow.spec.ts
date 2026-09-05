import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The registry block against `Testing.transport`: connect, plan, add, receipt, a refused token,
 * disconnect with cleanup, and the domain field's completion. The package's own tests cover the
 * hooks; this run covers the dialogs, the portals, and the focus the styled surface owns.
 */

const row = (page: Page): Locator => page.locator("[data-slot='provider-row']");
const rowFor = (page: Page, name: string): Locator =>
  page.locator("[data-slot='records-table'] tbody tr").filter({ hasText: name });

const connect = async (page: Page) => {
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Use an API token instead" }).click();
  return dialog;
};

test("heads the records card with the provider row and lists every requirement", async ({
  page,
}) => {
  await page.goto("/");
  await expect(row(page)).toContainText("Meridian DNS DNS detected");
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Value" })).toBeVisible();
  await expect(page.locator("[data-slot='records-table'] tbody tr")).toHaveCount(3);
  // The mark is the host's own node, with no tile drawn round it.
  await expect(row(page).locator("[data-slot='provider-mark'] svg")).toBeVisible();
});

test("connects, reads the plan in the table, and adds the records in one press", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await connect(page);
  await dialog.getByLabel("Token").fill("secret-token");
  await dialog.getByRole("button", { name: "Connect with an API token" }).click();

  await expect(row(page)).toContainText("Meridian DNS · northwind.app (Northwind Traders)");
  const add = row(page).getByRole("button", { name: /^Add \d+ records?$/ });
  await expect(add).toHaveText("Add 3 records");
  // The plan lands in the rows rather than behind a dialog of its own.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rowFor(page, "samva._domainkey")).toContainText("Will add");
  await add.click();

  // The receipt is what proves the records were written, and the row says how many.
  await expect(row(page)).toContainText("3 added");
  await expect(rowFor(page, "samva._domainkey")).not.toContainText("Will add");
});

test("answers a refused token beside the field the provider turned down", async ({ page }) => {
  await page.goto("/?connect=refused");
  const dialog = await connect(page);
  await dialog.getByLabel("Token").fill("wrong-token");
  await dialog.getByRole("button", { name: "Connect with an API token" }).click();
  // The provider answered the secret it was given, so the answer sits beside that field.
  await expect(dialog.getByRole("alert")).toContainText("Token not accepted");
  await expect(dialog.getByLabel("Token")).toHaveAttribute("aria-invalid", "true");
  // The form keeps what was typed, so trying again starts from the value rather than nothing.
  await expect(dialog.getByLabel("Token")).toHaveValue("wrong-token");
  await expect(dialog).toBeVisible();
});

test("removes the records it added, then releases the connection", async ({ page }) => {
  await page.goto("/");
  const dialog = await connect(page);
  await dialog.getByLabel("Token").fill("secret-token");
  await dialog.getByRole("button", { name: "Connect with an API token" }).click();
  await row(page)
    .getByRole("button", { name: /^Add \d+ records?$/ })
    .click();
  await expect(row(page)).toContainText("3 added");

  // Disconnecting is behind the row's menu, not beside the action the customer uses every day.
  await row(page).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  const releasing = page.getByRole("dialog");
  await expect(releasing).toBeVisible();
  // The cleanup plan is on screen while the customer decides, not after.
  await expect(releasing.getByRole("switch")).toBeVisible();
  await expect(releasing.getByRole("switch")).toBeChecked();
  await expect(releasing.locator("[data-slot='disconnect-cleanup'] li")).toHaveCount(3);
  await releasing.getByRole("button", { name: "Disconnect" }).click();

  await expect(row(page)).toContainText("Meridian DNS DNS detected");
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
});

test("says who may connect, and offers nothing, to a customer who may only read", async ({
  page,
}) => {
  await page.goto("/?mode=read-only");
  await expect(row(page)).toContainText("An administrator can connect Meridian DNS");
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
  // The records are still there to read: nothing collapses because a customer cannot write.
  await expect(page.locator("[data-slot='records-table'] tbody tr")).toHaveCount(3);
});

test("completes a typed domain from the zones the workspace's accounts reach", async ({ page }) => {
  await page.goto("/?view=field");
  // No account yet, so the field offers the provider rather than a list of zones.
  const offer = page.getByRole("button", { name: "Connect Meridian DNS" });
  await expect(offer).toBeVisible();
  await offer.click();
  await page.getByPlaceholder("Token").fill("secret-token");
  await page.getByRole("button", { name: "Connect with an API token" }).click();

  const input = page.getByRole("combobox");
  await input.click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await input.fill("mail.north");
  await expect(page.getByRole("option")).toHaveCount(1);
  await input.press("Tab");
  await expect(input).toHaveValue("mail.northwind.app");
  await expect(page.locator("[data-slot='domain-field-account']")).toContainText(
    "northwind.app (Northwind Traders)",
  );
});
