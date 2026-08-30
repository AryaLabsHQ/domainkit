import { defineConfig } from "blume";

export default defineConfig({
  ai: {
    llmsTxt: true,
  },
  content: {
    sources: [{ prefix: "docs", root: "content", type: "filesystem" }],
  },
  deployment: {
    output: "static",
    site: "https://domain-kit.dev",
  },
  description:
    "Provider-independent DNS provisioning plans, authorization, and React flows for TypeScript.",
  github: {
    dir: "apps/docs",
    owner: "AryaLabsHQ",
    repo: "domainkit",
  },
  logo: {
    text: "DomainKit",
  },
  navigation: {
    repo: true,
    tabs: [
      { label: "Docs", path: "/docs" },
      { label: "Workshop", path: "/workshop" },
    ],
  },
  search: {
    provider: "orama",
  },
  theme: {
    accent: "green",
    mode: "system",
    radius: "md",
  },
  title: "DomainKit",
});
