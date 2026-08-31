import { defineConfig } from "blume";

export default defineConfig({
  ai: {
    llmsTxt: true,
  },
  content: {
    root: "content",
    sources: [
      {
        exclude: ["components/**"],
        prefix: "docs",
        root: "content",
        type: "filesystem",
      },
      {
        include: ["components/**/*.{md,mdx}"],
        root: "content",
        type: "filesystem",
      },
    ],
  },
  deployment: {
    output: "static",
    site: "https://domain-kit.dev",
  },
  description: "Domain setup infrastructure for SaaS, with reviewable DNS plans and React flows.",
  examples: {
    css: "examples/theme.css",
    source: "examples",
  },
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
      { label: "Components", path: "/components" },
    ],
  },
  search: {
    provider: "orama",
  },
  seo: {
    og: {
      titles: {
        "/": "Build domain setup into your SaaS",
        "/components": "DomainKit React components",
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
