import { Secret, Vercel } from "domainkit/promise";

export async function connectVercelIntegration(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
}) {
  const credential = await Vercel.Auth.exchangeCode({
    clientId: input.clientId,
    clientSecret: Secret.make(input.clientSecret),
    code: Secret.make(input.code),
    redirectUri: input.redirectUri,
  });
  const provider = Vercel.make({
    capabilities: ["dns:read", "dns:write"],
    context: credential.context,
    token: credential.accessToken,
  });
  return { credential, provider };
}
