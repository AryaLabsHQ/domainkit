import { DnsRecord } from "domainkit";

// #region requirements
/** What a sending service returns for one customer domain, as DomainKit requirements. */
export const requirements = (domain: string) => [
  DnsRecord.spf({
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

// #region spf
/**
 * `DnsRecord.spf` is a standard TXT record with an SPF constraint. It plans beside unrelated TXT
 * such as verification tokens, and conflicts with a different SPF record, with more than one SPF
 * record, or with another requested SPF value.
 */
export const spfRequirement = (name: string, value: string) =>
  DnsRecord.spf({ name, value, purpose: "Authorize Acme to send" });
// #endregion spf

// #region spf-exclusive
/**
 * A generic `DnsRecord.txt` appends, even when its value is SPF. `exclusive` makes any other TXT
 * record at the name a Conflict, so use it only at a name the service owns.
 */
export const ownedTxtOrConflict = (name: string, value: string) =>
  DnsRecord.txt({
    name,
    value,
    policy: "exclusive",
    purpose: "Authorize Acme to send",
  });
// #endregion spf-exclusive
