import { defineConfig } from "tsdown";

/**
 * One ESM file per source module (`unbundle`), so every public module is its own subpath
 * (`domainkit/Principal`) and the root re-exports the same module instances. Declarations come
 * from `tsc -p tsconfig.build.json` into `dist/types/` with the same layout.
 */
export default defineConfig({
  clean: true,
  dts: false,
  entry: {
    Approval: "src/Approval.ts",
    Cleanup: "src/Cleanup.ts",
    Cloudflare: "src/Cloudflare.ts",
    Connect: "src/Connect.ts",
    Custody: "src/Custody.ts",
    DnsRecord: "src/DnsRecord.ts",
    DomainKit: "src/DomainKit.ts",
    DomainName: "src/DomainName.ts",
    Plan: "src/Plan.ts",
    Principal: "src/Principal.ts",
    Provider: "src/Provider.ts",
    Providers: "src/Providers.ts",
    Provision: "src/Provision.ts",
    Reason: "src/Reason.ts",
    Receipt: "src/Receipt.ts",
    Resolver: "src/Resolver.ts",
    Storage: "src/Storage.ts",
    Vercel: "src/Vercel.ts",
    Verify: "src/Verify.ts",
    "entry/client": "src/entry/client.ts",
    "entry/server": "src/entry/server.ts",
    "entry/testing": "src/entry/testing.ts",
    index: "src/index.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  root: "src",
  sourcemap: true,
  unbundle: true,
});
