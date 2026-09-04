import { expect, test } from "@playwright/test";

/** Screenshots land in the gitignored Playwright output directory, for PR review. */
const shot = (name: string) => `test-results/screenshots/${name}.png`;

/**
 * Where a provider offers a click-through method too, the token form waits behind a disclosure.
 * Every token path in this file opens it first, the way a customer who wants a token does.
 */
const revealToken = async (dialog: import("@playwright/test").Locator) => {
  const alternate = dialog.getByRole("button", { name: "Use an API token instead" });
  if ((await alternate.count()) > 0) await alternate.click();
};

const flow = (page: import("@playwright/test").Page) =>
  page.locator("[data-domainkit-part='domain-flow']");

const planDialog = (page: import("@playwright/test").Page) =>
  page.locator("[data-domainkit-part='plan-dialog']");

/** The plan opens itself on a connection; close it the way a customer who is not ready would. */
const setAside = async (page: import("@playwright/test").Page) => {
  const plan = planDialog(page);
  await plan.getByRole("button", { name: "Close" }).click();
  await expect(plan).toBeHidden();
};

/** A page load builds its own server, so every view opens on the fixture's one zone. */
const open = async (page: import("@playwright/test").Page, scheme = "light") => {
  await page.goto(`/?scheme=${scheme}`);
  await expect(page.getByRole("button", { exact: true, name: "Connect" })).toBeVisible();
};

test("renders the requirements table and the connect action", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "CNAME" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "TXT" })).toBeVisible();
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("flow") });
});

test("opens the connect dialog and renders the provider's declared token field", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Connect" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The provider's mark names it beside the heading, and the click-through method leads.
  await expect(dialog.locator("[data-domainkit-part='dialog-media']")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue with Meridian DNS" })).toBeVisible();
  await expect(dialog.getByLabel("Token")).toBeHidden();
  await dialog.screenshot({ path: shot("connect-dialog") });
  await revealToken(dialog);
  const field = dialog.getByLabel("Token");
  await expect(field).toHaveAttribute("type", "password");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { exact: true, name: "Connect" })).toBeFocused();
});

test("connects, reviews the plan, and approves it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Connect" }).click();
  await revealToken(page.getByRole("dialog"));
  await page.getByRole("dialog").getByLabel("Token").fill("secret-token");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  // The plan opened itself on the connection: the operations are listed and one action adds them.
  const plan = page.locator("[data-domainkit-part='plan-dialog']");
  await expect(plan.locator("[data-domainkit-part='plan-operations'] li")).toHaveCount(3);
  const add = plan.getByRole("button", { name: "Add 3 records" });
  await expect(add).toBeEnabled();
  // The header's close and a press outside dismiss the plan, so the footer is the plan's own.
  await expect(plan.getByRole("button", { name: "Not now" })).toHaveCount(0);
  await expect(plan.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(plan).toHaveCSS("opacity", "1");
  await plan.screenshot({ path: shot("plan-review") });
  await add.click();
  await expect(flow(page).getByText("DNS records added.")).toBeVisible();
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("applied") });

  // Removing the records DomainKit added is one decision inside the disconnect dialog.
  await page.getByRole("button", { name: "Disconnect" }).click();
  const disconnect = page.getByRole("dialog");
  // The description says what disconnecting does, in the present, about this domain.
  await expect(disconnect.locator("[data-domainkit-part='dialog-description']")).toHaveText(
    "DomainKit stops managing DNS for mail.northwind.dev through Meridian DNS.",
  );
  await expect(disconnect.getByRole("switch")).toBeChecked();
  // The records it would remove are listed, so the decision is taken over the thing itself, and
  // the dialog takes the width the plan dialog takes to list the same records.
  await expect(disconnect.locator("[data-domainkit-part='cleanup-operations'] li")).toHaveCount(3);
  await expect(disconnect.getByText("Remove the 3 records DomainKit added")).toBeVisible();
  await expect(disconnect).toHaveAttribute("data-cleanup", "offered");
  await expect(disconnect).toHaveCSS("width", "576px");
  await expect(disconnect).toHaveCSS("opacity", "1");
  await disconnect.screenshot({ path: shot("disconnect-dialog") });

  // Off, the records stay legible and step back, and the dialog keeps its width.
  await disconnect.getByRole("switch").click();
  await expect(disconnect.getByRole("switch")).not.toBeChecked();
  await expect(disconnect.getByText("Records stay in Meridian DNS.")).toBeVisible();
  await disconnect.screenshot({ path: shot("disconnect-dialog-keep") });
  await disconnect.getByRole("switch").click();
  await expect(disconnect.getByRole("switch")).toBeChecked();
  await disconnect.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Owns DNS for this domain.")).toBeVisible();
});

test("opens the verification popover and reads per-requirement evidence", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Connect" }).click();
  await revealToken(page.getByRole("dialog"));
  await page.getByRole("dialog").getByLabel("Token").fill("tok");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page
    .locator("[data-domainkit-part='plan-dialog']")
    .getByRole("button", { name: /^Add \d+ records?$/ })
    .click();
  await expect(flow(page).getByText("DNS records added.")).toBeVisible();

  await page.getByRole("button", { name: /Check/ }).click();
  const evidence = page.locator("[data-domainkit-part='observation-list']");
  await expect(evidence).toBeVisible();
  await expect(evidence.getByText("CNAME track.mail.northwind.dev")).toBeVisible();
  await expect(evidence.locator("[data-domainkit-part='record-status']").first()).toBeVisible();
  await page.locator("[data-domainkit-part='verification-popover']").screenshot({
    path: shot("verification"),
  });
});

test("names the expected value and what each observer read for a failing requirement", async ({
  page,
}) => {
  await page.goto("/?view=evidence");
  const evidence = page.locator("[data-domainkit-part='observation-list']");
  await expect(evidence).toBeVisible();
  await expect(evidence.getByText("Expected links.sendgate.app")).toBeVisible();
  await expect(
    evidence.getByText("Found links.legacy-sendgate.app", { exact: true }),
  ).toBeVisible();
  await expect(
    evidence.getByText("Found links.legacy-sendgate.app, links.old-sendgate.app"),
  ).toBeVisible();
  await expect(evidence.getByText("Found nothing")).toBeVisible();
  await expect(evidence.getByText("The name resolves somewhere else.")).toBeVisible();
  // The observer that never answered says so, rather than claiming the name is empty.
  await expect(evidence.getByText("The resolver did not answer.")).toBeVisible();
  await expect(evidence.getByText("Found nothing")).toHaveCount(1);
  await evidence.screenshot({ path: shot("evidence") });
});

test("lets a host's own rule beat a part, because the package ships in a cascade layer", async ({
  page,
}) => {
  await open(page);
  // The package sets `gap: 0.75rem` on this part; the host's unlayered `.host-flow` wins.
  await expect(flow(page)).toHaveClass(/host-flow/);
  await expect(flow(page)).toHaveCSS("gap", "48px");
  await flow(page).screenshot({ path: shot("host-override") });
});

test("sends the page the customer started from as the interactive return destination", async ({
  page,
}) => {
  await page.goto("/?view=returnto");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "Continue with Meridian DNS" }).click();
  const started = page.getByTestId("started");
  await expect(started).not.toBeEmpty();
  const method = JSON.parse((await started.textContent()) ?? "{}") as {
    readonly _tag: string;
    readonly returnTo?: string;
  };
  expect(method._tag).toBe("OAuth");
  expect(method.returnTo).toBe(page.url());
});

test("renders a read-only domain as state with no controls", async ({ page }) => {
  // Connect while writable, then flip the flag: the state stays, the controls go.
  await open(page);
  await page.getByRole("button", { name: "Connect" }).click();
  await revealToken(page.getByRole("dialog"));
  await page.getByRole("dialog").getByLabel("Token").fill("tok");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await setAside(page);

  await page.getByTestId("toggle-readonly").click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await Promise.all(
    ["Connect", "Detach domain", "Disconnect", "Review changes"].map((name) =>
      expect(page.getByRole("button", { name })).toHaveCount(0),
    ),
  );
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("read-only") });
});

test("verifies a domain with no attachment from the requirements the flow was given", async ({
  page,
}) => {
  await open(page);
  // Nothing is connected, so the receipt path has nothing to look for; the flow names its own.
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  // A status column only appears once an observation came back.
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Missing" })).toHaveCount(3);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: /Check/ }).click();
  const evidence = page.locator("[data-domainkit-part='observation-list']");
  await expect(evidence).toBeVisible();
  await expect(evidence.locator("[data-domainkit-part='observation-group']")).toHaveCount(3);
  await page
    .locator("[data-domainkit-part='verification-popover']")
    .screenshot({ path: shot("unattached-verify") });
});

test("takes theme tokens and the color scheme from the root", async ({ page }) => {
  await open(page, "dark");
  const root = page.locator("[data-domainkit-root]").first();
  await expect(root).toHaveAttribute("data-color-scheme", "dark");
  await expect(root).toHaveCSS("--domainkit-accent", "#4f46e5");
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("dark") });
});

test("renders an outcome as a card, as an inline row, and in a host's own composition", async ({
  page,
}) => {
  await page.goto("/?view=outcome");
  const outcomes = page.getByTestId("outcomes");
  await expect(outcomes.getByRole("alert")).toHaveCount(3);

  const card = page.getByTestId("outcome-card").locator("[data-domainkit-part='outcome']");
  await expect(card).toHaveAttribute("data-layout", "card");
  await expect(card).toHaveAttribute("data-tone", "danger");
  await expect(card.locator("[data-domainkit-part='outcome-media']")).toBeVisible();
  await expect(card.locator("[data-domainkit-part='outcome-title']")).toContainText(
    "could not be saved",
  );
  await expect(card.getByRole("button", { name: "Try again" })).toBeVisible();
  await card.screenshot({ path: shot("outcome-card") });

  const inline = page.getByTestId("outcome-inline").locator("[data-domainkit-part='outcome']");
  await expect(inline).toHaveAttribute("data-layout", "inline");
  // Three columns: the glyph, the words, the action. The glyph never wraps onto its own row.
  const box = async (part: string) => {
    const measured = await inline.locator(`[data-domainkit-part='${part}']`).boundingBox();
    if (measured === null) throw new Error(`${part} has no box`);
    return measured;
  };
  const media = await box("outcome-media");
  const title = await box("outcome-title");
  const description = await box("outcome-description");
  const action = await box("outcome-content");
  expect(media.x + media.width).toBeLessThanOrEqual(title.x);
  expect(media.y).toBeLessThan(title.y + title.height);
  expect(description.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  expect(Math.abs(description.x - title.x)).toBeLessThan(2);
  expect(action.x).toBeGreaterThanOrEqual(title.x + title.width - 1);
  await inline.screenshot({ path: shot("outcome-inline") });

  // A host brings its own media and drops the header; the words still come from the catalog.
  const host = page.getByTestId("outcome-host").locator("[data-domainkit-part='outcome']");
  await expect(host.getByTestId("host-media")).toBeVisible();
  await expect(host.locator("[data-domainkit-part='outcome-header']")).toHaveCount(0);
  await expect(host.locator("[data-domainkit-part='outcome-title']")).toContainText(
    "could not be saved",
  );
  await host.screenshot({ path: shot("outcome-host") });
});

test("keeps the domain, the provider list, and the typed token after a rejected connect", async ({
  page,
}) => {
  await page.goto("/?view=reject");
  await page.getByRole("button", { name: "Connect" }).click();
  const dialog = page.getByRole("dialog");
  await revealToken(dialog);
  await dialog.getByLabel("Token").fill("cf_bad_token");
  await dialog.getByLabel("Signing key").fill("sk_live");
  await dialog.getByRole("button", { name: "Connect with an API token" }).click();

  const outcome = dialog.locator("[data-domainkit-part='outcome']");
  await expect(outcome).toBeVisible();
  // The failure answers under the field it is about, on one line, and names the provider.
  await expect(outcome).toHaveAttribute("data-layout", "inline");
  await expect(dialog.locator("[data-domainkit-part='field-error']")).toContainText(
    "Token not accepted",
  );
  await expect(dialog.getByLabel("Token")).toHaveAttribute("aria-invalid", "true");
  // The provider named no field, so the first secret carries the answer and it announces once.
  await expect(dialog.locator("[data-domainkit-part='field-error']")).toHaveCount(1);
  await expect(dialog.getByLabel("Signing key")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toHaveCount(1);
  // The domain the dialog authorizes, and the value the customer typed, both survive.
  await expect(dialog.locator("[data-domainkit-part='dialog-description']")).toHaveText(
    "Authorize DNS changes for mail.northwind.dev.",
  );
  await expect(dialog.getByLabel("Token")).toHaveValue("cf_bad_token");
  await expect(dialog.getByLabel("Signing key")).toHaveValue("sk_live");
  await expect(dialog.getByText("No DNS providers are available.")).toHaveCount(0);
  await dialog.screenshot({ path: shot("connect-rejected") });
});

test("names the provider that serves the zone and offers to connect it", async ({ page }) => {
  await page.goto("/");
  const prompt = page.locator("[data-domainkit-part='connect-prompt']");
  await expect(prompt).toHaveAttribute("data-host", "meridian");
  await expect(prompt.getByRole("img", { name: "Meridian DNS" })).toBeVisible();
  await expect(prompt.locator("[data-domainkit-part='host-name']")).toHaveText("Meridian DNS");
  await expect(prompt.locator("[data-domainkit-part='host-statement']")).toHaveText(
    "Owns DNS for this domain.",
  );
  await expect(prompt.getByRole("button", { exact: true, name: "Connect" })).toBeVisible();
  await prompt.screenshot({ path: shot("connect-prompt") });
});

test("narrows the dialog to the provider that serves the zone", async ({ page }) => {
  await page.goto("/?view=providers");
  await page.getByRole("button", { exact: true, name: "Connect" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-domainkit-part='dialog-title']")).toContainText(
    "Connect Meridian DNS",
  );
  // The mark the prompt uses names the provider beside the heading.
  await expect(
    dialog.locator("[data-domainkit-part='dialog-media']").getByRole("img", { name: /Meridian/ }),
  ).toBeVisible();
  // One decision: the click-through method, with the token as a plain alternative under it.
  await expect(dialog.getByRole("button", { name: "Continue with Meridian DNS" })).toBeVisible();
  await expect(dialog.locator("[data-domainkit-part='token-connect']")).toHaveCount(0);
  await expect(dialog).toHaveCSS("opacity", "1");
  await dialog.screenshot({ path: shot("connect-dialog-narrowed") });

  // The token form takes the body, with the way back at the top of it.
  await dialog.getByRole("button", { name: "Use an API token instead" }).click();
  await expect(dialog.getByLabel("Token")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue with Meridian DNS" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Where do I find this?" })).toBeVisible();
  // The account id is a field the provider does not need, so a button of its own asks for it.
  const more = dialog.locator("[data-domainkit-part='more-options']");
  await expect(more).toHaveAttribute("data-state", "closed");
  await expect(dialog.getByLabel("Account id")).toBeHidden();
  await dialog.screenshot({ path: shot("connect-dialog-token") });
  await dialog.getByRole("button", { name: "Add an account id" }).click();
  await expect(more).toHaveAttribute("data-state", "open");
  await expect(dialog.getByLabel("Account id")).toBeVisible();
  await expect(more.locator("[data-domainkit-part='more-options-panel']")).toBeVisible();
  await dialog.screenshot({ path: shot("connect-dialog-token-more") });
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByRole("button", { name: "Continue with Meridian DNS" })).toBeVisible();

  // The provider that does not serve the zone is in the header menu.
  await dialog.getByRole("button", { name: /Connect Meridian DNS/ }).click();
  await page.getByRole("menuitem", { name: /Beacon Host/ }).click();
  await expect(dialog.locator("[data-domainkit-part='dialog-title']")).toContainText(
    "Connect Beacon Host",
  );
  // Vercel offers a token and nothing else, so its form opens directly.
  await expect(dialog.locator("[data-domainkit-part='token-connect']")).toHaveCount(1);
  await dialog.screenshot({ path: shot("connect-dialog-provider-menu") });
});

test("offers every provider, one open at a time, when nothing serves the zone", async ({
  page,
}) => {
  await page.goto("/?view=providers&host=none&connect=always");
  const trigger = page.getByRole("button", { name: "Connect a DNS provider" });
  await expect(trigger).toBeVisible();
  // No host means no identity to state.
  await expect(page.locator("[data-domainkit-part='host-identity']")).toHaveCount(0);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-domainkit-part='dialog-title']")).toHaveText(
    "Connect a DNS provider",
  );
  await expect(dialog.locator("[data-domainkit-part='provider-authentication']")).toHaveCount(2);
  // The first is open and the second is not, until the customer says otherwise.
  await expect(dialog.getByRole("button", { name: "Continue with Meridian DNS" })).toBeVisible();
  await dialog.getByRole("button", { name: "Beacon Host" }).click();
  await expect(
    dialog.locator("[data-domainkit-part='provider-authentication'][data-state='open']"),
  ).toHaveCount(1);
  // Vercel offers a token and nothing else, so opening it opens the form.
  await expect(dialog.locator("[data-domainkit-part='token-connect']")).toHaveCount(1);
  await dialog.screenshot({ path: shot("connect-dialog-all-providers") });
  // The heading closes what it opened, so the dialog can show no provider at all.
  await dialog.getByRole("button", { name: "Beacon Host" }).click();
  await expect(
    dialog.locator("[data-domainkit-part='provider-authentication'][data-state='open']"),
  ).toHaveCount(0);
});

test("offers nothing to connect when no provider serves the zone", async ({ page }) => {
  await page.goto("/?host=none");
  // The requirements still render; DomainKit says nothing at all about the connection.
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.locator("[data-domainkit-part='connect-prompt']")).toHaveCount(0);
  await expect(page.locator("[data-domainkit-part='connection-status']")).toHaveCount(0);
  await expect(page.getByText("No DNS provider is connected.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Connect/ })).toHaveCount(0);
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("no-host") });

  // The host application can ask for the dialog anyway.
  await page.goto("/?host=none&connect=always");
  await expect(page.getByRole("button", { name: "Connect a DNS provider" })).toBeVisible();
  await expect(page.locator("[data-domainkit-part='host-identity']")).toHaveCount(0);
});

test("keeps the host's identity and drops its trigger in read-only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { exact: true, name: "Connect" })).toBeVisible();
  await page.getByTestId("toggle-readonly").click();
  await expect(page.locator("[data-domainkit-part='host-statement']")).toHaveText(
    "Owns DNS for this domain.",
  );
  await expect(page.getByRole("button", { exact: true, name: "Connect" })).toHaveCount(0);
  await page
    .locator("[data-domainkit-part='connect-prompt']")
    .screenshot({ path: shot("prompt-read-only") });
});

/**
 * A press outside a modal dismisses it, and a command in flight is the one thing that keeps it.
 * The library's own backdrop must not swallow the press, and the guard must cancel only while busy.
 */
const backdropOf = (page: import("@playwright/test").Page) =>
  page.locator("[data-domainkit-part='dialog-backdrop']");

const pressOutside = async (page: import("@playwright/test").Page) => {
  const backdrop = backdropOf(page);
  await expect(backdrop).toBeVisible();
  await backdrop.click({ force: true, position: { x: 5, y: 5 } });
};

test("dismisses the connect and disconnect dialogs on an outside press", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog");

  await page.getByRole("button", { exact: true, name: "Connect" }).click();
  await expect(dialog).toBeVisible();
  await pressOutside(page);
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { exact: true, name: "Connect" }).click();
  await revealToken(dialog);
  await dialog.getByLabel("Token").fill("tok");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await setAside(page);

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(dialog).toBeVisible();
  // The plan was set aside rather than applied, so there is nothing to remove and no room needed.
  await expect(dialog).toHaveAttribute("data-cleanup", "none");
  await expect(dialog).toHaveCSS("width", "384px");
  await pressOutside(page);
  await expect(dialog).toBeHidden();
});

test("dismisses the review dialog on an outside press", async ({ page }) => {
  await page.goto("/?view=review");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { exact: true, name: "Connect" }).click();
  await revealToken(dialog);
  await dialog.getByLabel("Token").fill("tok");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  // `Provision.Flow` is the dialog on its own: no flow around it opens the plan, so the trigger does.
  await page.getByRole("button", { name: "Review changes" }).click();
  const plan = planDialog(page);
  await expect(plan.getByRole("button", { name: /^Add \d+ records?$/ })).toBeEnabled();
  await pressOutside(page);
  await expect(plan).toBeHidden();
});

test("keeps every dialog open while its own command is in flight", async ({ page }) => {
  const dialog = page.getByRole("dialog");

  // The connect dialog, with `connection.start` never answering.
  await page.goto("/?view=hang&hang=start");
  await page.getByRole("button", { exact: true, name: "Connect" }).click();
  await dialog.getByRole("button", { name: "Continue with Meridian DNS" }).click();
  await expect(dialog.getByText("Connecting…")).toBeVisible();
  await pressOutside(page);
  await expect(dialog).toBeVisible();

  // The disconnect dialog, with `connection.disconnect` never answering.
  await page.goto("/?view=hang&hang=disconnect");
  await page.getByRole("button", { exact: true, name: "Connect" }).click();
  await revealToken(dialog);
  await dialog.getByLabel("Token").fill("tok");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await setAside(page);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(dialog.getByText("Disconnecting…")).toBeVisible();
  await pressOutside(page);
  await expect(dialog).toBeVisible();

  // The review dialog, with `provisioning.plan` never answering.
  await page.goto("/?view=hang&hang=plan");
  await page.getByRole("button", { exact: true, name: "Connect" }).click();
  await revealToken(dialog);
  await dialog.getByLabel("Token").fill("tok");
  // The plan opens itself on the connection and never answers, so the progress is what shows.
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(planDialog(page).getByText("Preparing DNS changes…")).toBeVisible();
  await pressOutside(page);
  await expect(dialog).toBeVisible();
});
