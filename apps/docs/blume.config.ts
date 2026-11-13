import githubLightDefault from "@shikijs/themes/github-light-default";
import { defineConfig } from "blume";
import { orama } from "blume/search";
import { filesystem } from "blume/sources";

/**
 * GitHub's current code themes. Every token in `github-dark-default` clears WCAG AA (4.5:1) on the
 * dark page (`#0a0d12`) and code background (`#0f1319`); comments read 6.06:1 or better. In
 * `github-light-default` only comments fall short (`#6e7781`, 4.16:1 on `#f5f5f1`), so they take
 * Primer's muted foreground, `#59636e` (5.59:1). The older `github-light` also fails on its orange,
 * red, and green tokens against `#fbfbf9`.
 */
interface TokenRule {
  readonly scope?: string | readonly string[];
  readonly settings: { readonly foreground?: string };
}

const lightCodeTheme = {
  ...githubLightDefault,
  name: "domainkit-light",
  tokenColors: githubLightDefault.tokenColors?.map((rule: TokenRule) =>
    [rule.scope].flat().includes("comment")
      ? { ...rule, settings: { ...rule.settings, foreground: "#59636e" } }
      : rule,
  ),
};

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
          "guides/vercel-custom-domains.mdx",
        ],
        prefix: "docs",
        root: "content",
      }),
      filesystem({
        exclude: ["meta.ts"],
        include: ["components/**/*.{md,mdx}"],
        root: "content",
      }),
      filesystem({
        exclude: ["meta.ts", "guides/meta.ts"],
        include: [
          "compare/**/*.{md,mdx}",
          "customers/**/*.{md,mdx}",
          "guides/custom-domain-onboarding.mdx",
          "guides/email-domain-setup.mdx",
          "guides/vercel-custom-domains.mdx",
        ],
        root: "content",
      }),
    ],
  },
  deployment: {
    site: "https://domain-kit.dev",
  },
  description:
    "An open-source TypeScript library for custom domains in SaaS: it sets up a customer's DNS records through their own Cloudflare or Vercel account.",
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
  markdown: {
    code: {
      theme: {
        dark: "github-dark-default",
        light: lightCodeTheme,
      },
    },
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
      url: "https://arya.sh",
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
