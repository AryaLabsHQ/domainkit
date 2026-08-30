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
  description: "Domain setup infrastructure for SaaS, with reviewable DNS plans and React flows.",
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
  seo: {
    og: {
      titles: {
        "/": "Build domain setup into your SaaS",
        "/workshop": "Try DomainKit React DNS components",
      },
    },
  },
  theme: {
    accent: "blue",
    mode: "system",
    radius: "md",
  },
  title: "DomainKit",
});
