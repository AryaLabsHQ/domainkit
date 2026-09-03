import type { DnsRecord } from "domainkit";
import type { Transport } from "domainkit/client";
import { Domain, DomainKit } from "@domainkit/react";

declare const transport: Transport.Interface;
declare const requirements: ReadonlyArray<DnsRecord.Model>;

// #region theme
/** Every colour is a `--domainkit-*` custom property, so a theme is a plain object. */
export function BrandedSettings() {
  return (
    <DomainKit.Root
      colorScheme="inherit"
      theme={{
        accent: "var(--acme-brand)",
        accentContrast: "#ffffff",
        fontFamily: "var(--acme-font)",
        radius: "0.75rem",
      }}
      transport={transport}
    >
      <Domain.Flow domain="app.example.com" requirements={requirements} />
    </DomainKit.Root>
  );
}
// #endregion theme

// #region messages
/** `Messages.Catalog` holds every user-visible string, including one sentence per failure reason. */
export function LocalisedSettings() {
  return (
    <DomainKit.Root
      messages={{
        approve: "Apply these DNS changes",
        decline: "Not right now",
        fieldLabel: (name) => (name === "accountId" ? "Cloudflare account ID" : name),
        reconnect: (reason) => `Your ${reason.provider} connection expired. Connect it again.`,
      }}
      transport={transport}
    >
      <Domain.Flow domain="app.example.com" requirements={requirements} />
    </DomainKit.Root>
  );
}
// #endregion messages

// #region marks
/** Provider artwork is host-supplied and nothing is fetched at render time. */
export function BrandedProviders() {
  return (
    <DomainKit.Root
      marks={{
        cloudflare: <img alt="" height={20} src="/logos/cloudflare.svg" width={20} />,
        vercel: (provider) => <span aria-hidden="true">{provider.name.charAt(0)}</span>,
      }}
      transport={transport}
    >
      <Domain.Flow domain="app.example.com" requirements={requirements} />
    </DomainKit.Root>
  );
}
// #endregion marks
