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
  await expect(row(page)).toContainText("Meridian DNS detected");
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Value" })).toBeVisible();
  await expect(page.locator("[data-slot='records-table'] tbody tr")).toHaveCount(4);
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

  await expect(row(page)).toContainText("Meridian · northwind.app (Northwind Traders)");
  const add = row(page).getByRole("button", { name: /^Add \d+ records?$/ });
  await expect(add).toHaveText("Add 3 records");
  // The plan lands in the rows rather than behind a dialog of its own.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // One record is already in place; the other three are added in one press.
  await expect(rowFor(page, "samva._domainkey")).toContainText("Will add");
  await expect(rowFor(page, "track.mail")).toContainText("Will add");
  await expect(rowFor(page, "v=spf1")).toContainText("Already set");
  await add.click();

  // The receipt says how many were written, and the read-back finds every record.
  await expect(row(page)).toContainText("3 added");
  await Promise.all(
    ["samva._domainkey", "track.mail", "v=spf1"].map(async (name) => {
      await expect(rowFor(page, name)).toContainText("Found");
      await expect(rowFor(page, name)).not.toContainText("Will add");
    }),
  );
  await expect(page.getByText("Conflict")).toHaveCount(0);
});

test("approves only the creates when a record on the tracking host blocks its CNAME", async ({
  page,
}) => {
  await page.goto("/?seed=conflict");
  const dialog = await connect(page);
  await dialog.getByLabel("Token").fill("secret-token");
  await dialog.getByRole("button", { name: "Connect with an API token" }).click();

  const add = row(page).getByRole("button", { name: /^Add \d+ records?$/ });
  await expect(add).toHaveText("Add 2 records");
  await expect(rowFor(page, "samva._domainkey")).toContainText("Will add");
  await expect(rowFor(page, "v=spf1")).toContainText("Already set");
  await expect(rowFor(page, "track.mail")).toContainText("Conflict");
  await expect(rowFor(page, "track.mail")).not.toContainText("Will add");
  await add.click();

  // The blocked record stays blocked, and the row says what to fix.
  await expect(rowFor(page, "samva._domainkey")).toContainText("Found");
  await expect(rowFor(page, "track.mail")).toContainText("Conflict");
  await expect(rowFor(page, "track.mail")).toContainText("Different value");
  await expect(row(page)).toContainText("Resolve the records above at your provider");
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
  await expect(rowFor(page, "samva._domainkey")).toContainText("Found");

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

  await expect(row(page)).toContainText("Meridian DNS detected");
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
});

test("says who may connect, and offers nothing, to a customer who may only read", async ({
  page,
}) => {
  await page.goto("/?mode=read-only");
  await expect(row(page)).toContainText("An administrator can connect Meridian");
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
  // The records are still there to read: nothing collapses because a customer cannot write.
  await expect(page.locator("[data-slot='records-table'] tbody tr")).toHaveCount(4);
});

test("completes a typed domain from the zones the workspace's accounts reach", async ({ page }) => {
  await page.goto("/?view=field");
  // No account yet, so the field offers the provider rather than a list of zones.
  const offer = page.getByRole("button", { name: "Connect Meridian" });
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

const recoveryAlert = (page: Page) => page.locator("[data-slot='callback-recovery']");
const recoveryTitles = {
  cancelled: "Connecting Meridian was cancelled",
  restart: "Start connecting Meridian again",
  inspect: "Check your Meridian accounts",
};

for (const view of ["flow", "field"]) {
  for (const kind of ["cancelled", "restart", "inspect"] as const) {
    test(`${view} reports ${kind} recovery and dismisses only its URL hints`, async ({ page }) => {
      await page.goto(
        `/?view=${view}&method=oauth&domainkit=${kind}&domainkit-provider=meridian&host-value=keep&host-value=also#accounts`,
      );
      const alert = recoveryAlert(page);
      await expect(alert).toContainText(recoveryTitles[kind]);
      await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(
        kind === "inspect" ? 0 : 1,
      );
      if (kind === "inspect") await expect(alert).toContainText("Inspect your connected accounts");
      await page.evaluate(() => window.history.replaceState({ host: "kept" }, ""));
      await alert.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(alert).toHaveCount(0);
      const url = new URL(page.url());
      expect(url.searchParams.has("domainkit")).toBe(false);
      expect(url.searchParams.has("domainkit-provider")).toBe(false);
      expect(url.searchParams.getAll("host-value")).toEqual(["keep", "also"]);
      expect(url.hash).toBe("#accounts");
      expect(await page.evaluate(() => window.history.state)).toEqual({ host: "kept" });
      await expect(page.locator("[data-slot='fixture-destination']")).toHaveText("");
    });
  }

  for (const kind of ["cancelled", "restart"] as const) {
    test(`${view} retries ${kind} with the hinted provider and a clean return URL`, async ({
      page,
    }) => {
      await page.goto(
        `/?view=${view}&method=oauth&domainkit=${kind}&domainkit-provider=meridian&host-value=keep#accounts`,
      );
      await recoveryAlert(page).getByRole("button", { name: "Try again" }).click();
      await expect(recoveryAlert(page)).toHaveCount(0);
      await expect(page.locator("[data-slot='fixture-destination']")).not.toHaveText("");
      const calls = await page.locator("[data-slot='fixture-calls']").textContent();
      expect(calls).not.toBeNull();
      const starts = JSON.parse(calls ?? "[]").filter(
        (call: { method: string }) => call.method === "connection.start",
      );
      expect(starts).toHaveLength(1);
      expect(starts[0].input.provider).toBe("meridian");
      expect(starts[0].input.method._tag).toBe("OAuth");
      expect(starts[0].input.method.returnTo).toMatch(/^\//);
      const returnTo = new URL(starts[0].input.method.returnTo, "http://domainkit.test");
      expect(returnTo.searchParams.has("domainkit")).toBe(false);
      expect(returnTo.searchParams.has("domainkit-provider")).toBe(false);
      expect(returnTo.searchParams.get("host-value")).toBe("keep");
      expect(returnTo.hash).toBe("#accounts");
    });
  }

  test(`${view} keeps recovery dismissible in read-only mode`, async ({ page }) => {
    await page.goto(
      `/?view=${view}&method=oauth&mode=read-only&domainkit=restart&domainkit-provider=meridian`,
    );
    const alert = recoveryAlert(page);
    await expect(alert).toContainText(recoveryTitles.restart);
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(alert.getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  test(`${view} offers no recovery retry for an unknown provider`, async ({ page }) => {
    await page.goto(`/?view=${view}&domainkit=restart&domainkit-provider=missing`);
    const alert = recoveryAlert(page);
    await expect(alert).toContainText("missing");
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0);
  });
}

test("a token-only provider offers no recovery retry", async ({ page }) => {
  await page.goto("/?view=field&domainkit=restart&domainkit-provider=meridian");
  await expect(recoveryAlert(page)).toContainText(recoveryTitles.restart);
  await expect(recoveryAlert(page).getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("inspection guidance stays available beside the field's connected accounts and zones", async ({
  page,
}) => {
  await page.goto("/?view=field&domainkit=inspect&domainkit-provider=meridian");
  await page.getByRole("button", { name: "Connect Meridian" }).click();
  await page.getByPlaceholder("Token").fill("secret-token");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  const input = page.getByRole("combobox");
  await input.fill("mail.north");
  await expect(page.getByRole("option")).toHaveCount(1);
  await input.press("Tab");
  await expect(page.locator("[data-slot='domain-field-account']")).toContainText(
    "Northwind Traders",
  );
  await expect(recoveryAlert(page)).toContainText("Inspect your connected accounts");
  await expect(recoveryAlert(page).getByRole("button", { name: "Try again" })).toHaveCount(0);
});
