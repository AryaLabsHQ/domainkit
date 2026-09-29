import { defineConfig } from "blume";

export default defineConfig({
  ai: {
    llmsTxt: true,
  },
  content: {
    root: "content",
    sources: [
      {
        exclude: [
          "components/**",
          "compare/**",
          "customers/**",
          "guides/custom-domain-onboarding.mdx",
          "guides/email-domain-setup.mdx",
        ],
        prefix: "docs",
        root: "content",
        type: "filesystem",
      },
      {
        include: ["components/**/*.{md,mdx}"],
        root: "content",
        type: "filesystem",
      },
      {
        include: [
          "compare/**/*.{md,mdx}",
          "customers/**/*.{md,mdx}",
          "guides/custom-domain-onboarding.mdx",
          "guides/email-domain-setup.mdx",
        ],
        root: "content",
        type: "filesystem",
      },
    ],
  },
  deployment: {
    output: "static",
    site: "https://domain-kit.dev",
  },
  description: "Add custom domains to your app with reviewable DNS plans and React flows.",
  examples: {
    css: "examples/theme.css",
    source: "examples",
  },
  github: {
    dir: "apps/docs",
    owner: "AryaLabsHQ",
    repo: "domainkit",
  },
  lastModified: { type: "git" },
  logo: {
    image: "/logo.svg",
    text: "DomainKit",
  },
  navigation: {
    repo: true,
    tabs: [
      { label: "Docs", path: "/docs" },
      { label: "Guides", path: "/guides/custom-domain-onboarding" },
      { label: "Compare", path: "/compare/entri" },
      { label: "Components", path: "/components" },
    ],
  },
  search: {
    provider: "orama",
  },
  seo: {
    og: {
      titles: {
        "/": "Add custom domains to your app",
        "/components": "DomainKit React components",
      },
    },
  },
  theme: {
    accent: { dark: "#4b88ff", light: "#0b5cff" },
    fonts: { body: "geist", display: "geist", mono: "geist-mono" },
    mode: "system",
    radius: "sm",
  },
  title: "DomainKit",
});
