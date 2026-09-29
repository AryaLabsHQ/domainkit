import { DnsRecord } from "domainkit";

// #region requirements
/**
 * What Cloudflare told you to have the customer add for one custom hostname. `validation` holds
 * every TXT record Cloudflare returned: the `ownership_verification` record and each TXT entry in
 * `ssl.validation_records`.
 */
export const requirements = (input: {
  readonly hostname: string;
  readonly target: string;
  readonly validation: ReadonlyArray<{
    readonly name: string;
    readonly value: string;
  }>;
}) => [
  DnsRecord.cname({
    name: input.hostname,
    target: input.target,
    purpose: "Send traffic to your app",
  }),
  ...input.validation.map((record) =>
    DnsRecord.txt({
      name: record.name,
      value: record.value,
      purpose: "Prove you own the domain",
    }),
  ),
];
// #endregion requirements
