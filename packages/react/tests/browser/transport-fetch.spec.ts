import { expect, test } from "@playwright/test";
import { DomainKit } from "domainkit";
import { Server } from "domainkit/server";
import { Testing } from "domainkit/testing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * A real `domainkit/server` answers the page's requests from Node; the page side is
 * `Transport.fromFetch("/api/domainkit")` over Chrome's own `fetch`, which throws "Illegal
 * invocation" when called as a method of anything but `window`.
 */
test("the default fetch reaches the server from a browser page", async ({ page }) => {
  const { handler } = Server.toWebHandler(
    DomainKit.layerMemory({
      providers: [Testing.provider({ zones: ["northwind.dev"] })],
      resolver: Testing.resolver(),
    }).pipe(
      Layer.merge(
        Layer.succeed(Server.Identity)({ principal: () => Effect.succeed(Testing.principal) }),
      ),
    ),
    { prefix: "/api/domainkit" },
  );
  await page.route("**/api/domainkit/**", async (route) => {
    const request = route.request();
    const body = request.postData();
    const response = await handler(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        ...(body === null ? {} : { body }),
      }),
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    });
  });
  await page.goto("/?view=fetch");
  const probe = page.getByTestId("fetch-probe");
  await expect(probe).not.toHaveText("pending");
  await expect(probe).toHaveText(
    JSON.stringify({ status: "disconnected", domain: "mail.northwind.dev" }),
  );
});
