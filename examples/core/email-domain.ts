import { DnsRecord } from "domainkit";

// #region requirements
/** What a sending service returns for one customer domain, as DomainKit requirements. */
export const requirements = (domain: string) => [
  DnsRecord.txt({
    name: `send.${domain}`,
    value: "v=spf1 include:mail.acme.dev ~all",
    purpose: "Authorize Acme to send for this domain",
  }),
  DnsRecord.mx({
    name: `send.${domain}`,
    exchange: "feedback.acme.dev",
    priority: 10,
    policy: "exclusive",
    purpose: "Receive bounces",
  }),
  DnsRecord.cname({
    name: `k1._domainkey.${domain}`,
    target: "k1.dkim.acme.dev",
    purpose: "Sign your mail",
  }),
  DnsRecord.cname({
    name: `track.${domain}`,
    target: "links.acme.dev",
    purpose: "Serve branded links",
  }),
];
// #endregion requirements

// #region spf-exclusive
/**
 * SPF is an ordinary TXT record to DomainKit, so the default `append` policy plans a second TXT
 * beside any SPF value already at the name. `exclusive` turns that case into a Conflict.
 */
export const spfOrConflict = (name: string, value: string) =>
  DnsRecord.txt({ name, value, policy: "exclusive", purpose: "Authorize Acme to send" });
// #endregion spf-exclusive
