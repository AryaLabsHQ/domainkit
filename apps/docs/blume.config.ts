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
    "Reviewable DNS provisioning for TypeScript, with React flows you host.",
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
        "/": "Reviewable DNS plans for TypeScript",
        "/workshop": "Try DomainKit React DNS components",
      },
    },
  },
  theme: {
    accent: "green",
    mode: "system",
    radius: "md",
  },
  title: "DomainKit",
});
