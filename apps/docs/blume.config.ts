import { defineConfig } from "blume";
import { orama } from "blume/search";
import { filesystem } from "blume/sources";

export default defineConfig({
  agents: {
    llmsTxt: true,
  },
  content: {
    sources: [
      filesystem({
        exclude: [
          "components/**",
          "compare/**",
          "customers/**",
          "guides/custom-domain-onboarding.mdx",
          "guides/email-domain-setup.mdx",
        ],
        prefix: "docs",
        root: "content",
      }),
      filesystem({
        include: ["components/**/*.{md,mdx}"],
        root: "content",
      }),
      filesystem({
        include: [
          "compare/**/*.{md,mdx}",
          "customers/**/*.{md,mdx}",
          "guides/custom-domain-onboarding.mdx",
          "guides/email-domain-setup.mdx",
        ],
        root: "content",
      }),
    ],
  },
  deployment: {
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
  lastModified: "git",
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
  search: orama(),
  seo: {
    organization: {
      logo: "/logo.svg",
      name: "Arya Labs",
      sameAs: ["https://github.com/AryaLabsHQ"],
    },
    og: {
      titles: {
        "/": "Add custom domains to your app",
        "/components": "DomainKit React components",
      },
    },
    software: {
      applicationCategory: "DeveloperApplication",
      description:
        "An open-source TypeScript library that sets up a customer's DNS records through their own Cloudflare or Vercel account.",
      license: "MIT",
      name: "DomainKit",
      price: 0,
      priceCurrency: "USD",
      sameAs: [
        "https://github.com/AryaLabsHQ/domainkit",
        "https://www.npmjs.com/package/domainkit",
        "https://www.npmjs.com/package/@domainkit/react",
        "https://www.npmjs.com/package/@domainkit/capsuledb",
      ],
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
