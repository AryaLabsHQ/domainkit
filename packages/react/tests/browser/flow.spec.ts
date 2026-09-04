import { expect, test } from "@playwright/test";

/** Screenshots land in the gitignored Playwright output directory, for PR review. */
const shot = (name: string) => `test-results/screenshots/${name}.png`;

/**
 * Where a provider offers a click-through method too, the token form waits behind a disclosure.
 * Every token path in this file opens it first, the way a customer who wants a token does.
 */
const revealToken = async (dialog: import("@playwright/test").Locator) => {
  const disclosure = dialog.getByText("Use an API token instead");
  if ((await disclosure.count()) > 0) await disclosure.click();
};

/** A zone per test keeps the fixture's fake provider from seeing another test's records. */
const open = async (page: import("@playwright/test").Page, zone: string, scheme = "light") => {
  await page.goto(`/?zone=${zone}&scheme=${scheme}`);
  await expect(page.getByRole("button", { exact: true, name: "Connect" })).toBeVisible();
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
  // The provider's mark names it beside the heading, and the click-through method leads.
  await expect(dialog.locator("[data-domainkit-part='dialog-media']")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue with Fake fake" })).toBeVisible();
  await expect(dialog.getByLabel("Token")).toBeHidden();
  await dialog.screenshot({ path: shot("connect-dialog") });
  await revealToken(dialog);
  const field = dialog.getByLabel("Token");
  await expect(field).toHaveAttribute("type", "password");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { exact: true, name: "Connect" })).toBeFocused();
});

test("connects, reviews the plan, and approves it", async ({ page }) => {
  await open(page, "browser3.example");
  await page.getByRole("button", { name: "Connect" }).click();
  await revealToken(page.getByRole("dialog"));
  await page.getByRole("dialog").getByLabel("Token").fill("secret-token");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
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

test("opens the verification popover and reads per-requirement evidence", async ({ page }) => {
  await open(page, "browser5.example");
  await page.getByRole("button", { name: "Connect" }).click();
  await revealToken(page.getByRole("dialog"));
  await page.getByRole("dialog").getByLabel("Token").fill("tok");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(page.getByText("fake connected")).toBeVisible();
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("DNS records added.")).toBeVisible();

  await page.getByRole("button", { name: /Check/ }).click();
  const evidence = page.locator("[data-domainkit-part='observation-list']");
  await expect(evidence).toBeVisible();
  await expect(evidence.getByText("CNAME app.browser5.example")).toBeVisible();
  await expect(evidence.locator("[data-domainkit-part='record-status']").first()).toBeVisible();
  await page.locator("[data-domainkit-part='verification-popover']").screenshot({
    path: shot("verification"),
  });
});

test("names the expected value and what each observer read for a failing requirement", async ({
  page,
}) => {
  await page.goto("/?zone=browser6.example&view=evidence");
  const evidence = page.locator("[data-domainkit-part='observation-list']");
  await expect(evidence).toBeVisible();
  await expect(evidence.getByText("Expected edge.example.com")).toBeVisible();
  await expect(evidence.getByText("Found old.example.com", { exact: true })).toBeVisible();
  await expect(evidence.getByText("Found old.example.com, older.example.com")).toBeVisible();
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
  await open(page, "browser7.example");
  const flow = page.locator("[data-domainkit-part='domain-flow']");
  // The package sets `gap: 0.75rem` on this part; the host's unlayered `.host-flow` wins.
  await expect(flow).toHaveClass(/host-flow/);
  await expect(flow).toHaveCSS("gap", "48px");
  await flow.screenshot({ path: shot("host-override") });
});

test("sends the page the customer started from as the interactive return destination", async ({
  page,
}) => {
  await page.goto("/?zone=browser8.example&view=returnto");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "Continue with Fake fake" }).click();
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
  await open(page, "browser9.example");
  await page.getByRole("button", { name: "Connect" }).click();
  await revealToken(page.getByRole("dialog"));
  await page.getByRole("dialog").getByLabel("Token").fill("tok");
  await page.getByRole("button", { name: "Connect with an API token" }).click();
  await expect(page.getByText("fake connected")).toBeVisible();

  await page.getByTestId("toggle-readonly").click();
  await expect(page.getByText("fake connected")).toBeVisible();
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
  await open(page, "browser10.example");
  // Nothing is connected, so the receipt path has nothing to look for; the flow names its own.
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  // A status column only appears once an observation came back.
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Missing" })).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: /Check/ }).click();
  const evidence = page.locator("[data-domainkit-part='observation-list']");
  await expect(evidence).toBeVisible();
  await expect(evidence.locator("[data-domainkit-part='observation-group']")).toHaveCount(2);
  await page
    .locator("[data-domainkit-part='verification-popover']")
    .screenshot({ path: shot("unattached-verify") });
});

test("takes theme tokens and the color scheme from the root", async ({ page }) => {
  await open(page, "browser4.example", "dark");
  const root = page.locator("[data-domainkit-root]").first();
  await expect(root).toHaveAttribute("data-color-scheme", "dark");
  await expect(root).toHaveCSS("--domainkit-accent", "#4f46e5");
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("dark") });
});

test("renders an outcome as a card, as an inline row, and in a host's own composition", async ({
  page,
}) => {
  await page.goto("/?zone=browser11.example&view=outcome");
  const outcomes = page.getByTestId("outcomes");
  await expect(outcomes.getByRole("alert")).toHaveCount(3);

  const card = page.getByTestId("outcome-card").locator("[data-domainkit-part='outcome']");
  await expect(card).toHaveAttribute("data-layout", "card");
  await expect(card).toHaveAttribute("data-tone", "danger");
  await expect(card.locator("[data-domainkit-part='outcome-media']")).toBeVisible();
  await expect(card.locator("[data-domainkit-part='outcome-title']")).toContainText(
    "didn't accept this token",
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
    "didn't accept this token",
  );
  await host.screenshot({ path: shot("outcome-host") });
});

test("keeps the domain, the provider list, and the typed token after a rejected connect", async ({
  page,
}) => {
  await page.goto("/?zone=browser12.example&view=reject");
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
    "Fake fake didn't accept this token",
  );
  await expect(dialog.getByLabel("Token")).toHaveAttribute("aria-invalid", "true");
  // The provider named no field, so the first secret carries the answer and it announces once.
  await expect(dialog.locator("[data-domainkit-part='field-error']")).toHaveCount(1);
  await expect(dialog.getByLabel("Signing key")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toHaveCount(1);
  // The domain the dialog authorizes, and the value the customer typed, both survive.
  await expect(dialog.locator("[data-domainkit-part='dialog-description']")).toHaveText(
    "Authorize DNS changes for app.browser12.example.",
  );
  await expect(dialog.getByLabel("Token")).toHaveValue("cf_bad_token");
  await expect(dialog.getByLabel("Signing key")).toHaveValue("sk_live");
  await expect(dialog.getByText("No DNS providers are available.")).toHaveCount(0);
  await dialog.screenshot({ path: shot("connect-rejected") });
});

test("names the provider that serves the zone and offers to connect it", async ({ page }) => {
  await page.goto("/?zone=browser13.example");
  const prompt = page.locator("[data-domainkit-part='connect-prompt']");
  await expect(prompt).toHaveAttribute("data-host", "fake");
  await expect(prompt.getByRole("img", { name: "Fake fake" })).toBeVisible();
  await expect(prompt.locator("[data-domainkit-part='host-name']")).toHaveText("Fake fake");
  await expect(prompt.locator("[data-domainkit-part='host-statement']")).toHaveText(
    "Owns DNS for this domain.",
  );
  await expect(prompt.getByRole("button", { exact: true, name: "Connect" })).toBeVisible();
  await prompt.screenshot({ path: shot("connect-prompt") });
});

test("narrows the dialog to the provider that serves the zone", async ({ page }) => {
  await page.goto("/?zone=browser14.example&view=providers");
  await page.getByRole("button", { exact: true, name: "Connect" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-domainkit-part='dialog-title']")).toHaveText(
    "Connect Fake cloudflare",
  );
  // The mark the prompt uses names the provider beside the heading.
  await expect(
    dialog.locator("[data-domainkit-part='dialog-media']").getByRole("img", { name: /cloudflare/ }),
  ).toBeVisible();
  // One provider's methods: the click-through one leads and the token form waits behind it.
  await expect(dialog.locator("[data-domainkit-part='token-connect']")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Continue with Fake cloudflare" })).toBeVisible();
  await expect(dialog.getByLabel("Token")).toBeHidden();
  await dialog.screenshot({ path: shot("connect-dialog-narrowed") });
  await revealToken(dialog);
  await expect(dialog.getByLabel("Token")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Connect with an API token" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Where do I find this?" })).toBeVisible();
  // The account id is a field the provider does not need, so it waits behind a disclosure.
  await expect(dialog.getByLabel("Account id")).toBeHidden();
  await dialog.screenshot({ path: shot("connect-dialog-token") });
  await dialog.getByText("Need an account id?").click();
  await expect(dialog.getByLabel("Account id")).toBeVisible();

  // The provider that does not serve the zone is one disclosure away.
  await dialog.getByText("Use a different provider").click();
  await dialog.getByRole("button", { name: "Fake vercel" }).click();
  await expect(dialog.locator("[data-domainkit-part='token-connect']")).toHaveCount(2);
  await dialog.screenshot({ path: shot("connect-dialog-other-providers") });
});

test("offers every provider, one open at a time, when nothing serves the zone", async ({
  page,
}) => {
  await page.goto("/?zone=browser15.example&view=providers&host=none&connect=always");
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
  await expect(dialog.locator("[data-domainkit-part='token-connect']")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Fake vercel" }).click();
  await expect(
    dialog.locator("[data-domainkit-part='provider-authentication'][data-state='open']"),
  ).toHaveCount(1);
  await dialog.screenshot({ path: shot("connect-dialog-all-providers") });
  // The heading closes what it opened, so the dialog can show no provider at all.
  await dialog.getByRole("button", { name: "Fake vercel" }).click();
  await expect(
    dialog.locator("[data-domainkit-part='provider-authentication'][data-state='open']"),
  ).toHaveCount(0);
});

test("offers nothing to connect when no provider serves the zone", async ({ page }) => {
  await page.goto("/?zone=browser16.example&host=none");
  // The requirements still render; there is simply nothing DomainKit can connect.
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.locator("[data-domainkit-part='connect-prompt']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Connect/ })).toHaveCount(0);
  await page.locator("[data-domainkit-part='domain-flow']").screenshot({ path: shot("no-host") });

  // The host application can ask for the dialog anyway.
  await page.goto("/?zone=browser17.example&host=none&connect=always");
  await expect(page.getByRole("button", { name: "Connect a DNS provider" })).toBeVisible();
  await expect(page.locator("[data-domainkit-part='host-identity']")).toHaveCount(0);
});

test("keeps the host's identity and drops its trigger in read-only", async ({ page }) => {
  await page.goto("/?zone=browser18.example");
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
