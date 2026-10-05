import { DnsRecord, Provision } from "domainkit";

const projectId = "prj_saas_app";
const vercelHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

// #region add-to-project
/**
 * Vercel's API, not DomainKit, attaches the customer's hostname to your own Vercel project. The
 * response says whether Vercel still wants a TXT record before it will serve the hostname.
 */
export const addToProject = async (input: {
  readonly hostname: string;
  readonly token: string;
}) => {
  const response = await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains`, {
    method: "POST",
    headers: vercelHeaders(input.token),
    body: JSON.stringify({ name: input.hostname }),
  });
  if (!response.ok) throw new Error(`Vercel refused ${input.hostname}: ${response.status}`);
  return (await response.json()) as {
    readonly name: string;
    readonly verified: boolean;
    readonly verification?: ReadonlyArray<{
      readonly type: string;
      readonly domain: string;
      readonly value: string;
    }>;
  };
};
// #endregion add-to-project

// #region requirements
/**
 * What Vercel told you the customer must add: where the hostname should point, and any TXT proof
 * Vercel asked for. Pass the values Vercel returned; do not copy them from a docs page.
 */
export const requirements = (input: {
  readonly hostname: string;
  readonly route: { readonly cname: string } | { readonly address: string };
  readonly verification: ReadonlyArray<{ readonly domain: string; readonly value: string }>;
}) => [
  "cname" in input.route
    ? DnsRecord.cname({
        name: input.hostname,
        target: input.route.cname,
        purpose: "Send traffic to your app",
      })
    : DnsRecord.a({
        name: input.hostname,
        address: input.route.address,
        purpose: "Send traffic to your app",
      }),
  ...input.verification.map((record) =>
    DnsRecord.txt({
      name: record.domain,
      value: record.value,
      purpose: "Prove you own the domain",
    }),
  ),
];
// #endregion requirements

// #region plan
/**
 * DomainKit reads the customer's zone, wherever their DNS lives, and returns the operations the
 * customer reviews. This step never writes.
 */
export const planForCustomer = (input: Parameters<typeof requirements>[0]) =>
  Provision.plan({ domain: input.hostname, requirements: requirements(input) });
// #endregion plan
