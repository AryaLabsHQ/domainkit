import { DnsRecord } from "domainkit";

// #region requirements
/** What Cloudflare told you to have the customer add for one custom hostname. */
export const requirements = (input: {
  readonly hostname: string;
  readonly target: string;
  readonly validation: { readonly name: string; readonly value: string };
}) => [
  DnsRecord.cname({
    name: input.hostname,
    target: input.target,
    purpose: "Send traffic to your app",
  }),
  DnsRecord.txt({
    name: input.validation.name,
    value: input.validation.value,
    purpose: "Prove you own the domain",
  }),
];
// #endregion requirements
