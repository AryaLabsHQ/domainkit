import { Messages } from "../src/index.ts";

describe("messages", () => {
  it("completes a partial host override with the English catalog", () => {
    expect(
      Messages.merge({ connectProvider: () => "Authorize" }).providerAvailable("Cloudflare"),
    ).toBe("Cloudflare manages DNS for this domain");
    expect(
      Messages.merge({ connectProvider: () => "Authorize" }).connectProvider("Cloudflare"),
    ).toBe("Authorize");
  });
});
