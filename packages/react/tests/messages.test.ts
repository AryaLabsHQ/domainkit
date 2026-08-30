import { Messages } from "../src/index.ts";

describe("messages", () => {
  it("completes a catalog created before provider availability copy existed", () => {
    const { providerAvailable, ...previousCatalog } = Messages.english;
    const catalog: Messages.Catalog = previousCatalog;

    expect(providerAvailable("Cloudflare")).toBe("Cloudflare manages DNS for this domain");
    expect(Messages.merge(catalog).providerAvailable("Cloudflare")).toBe(
      "Cloudflare manages DNS for this domain",
    );
  });
});
