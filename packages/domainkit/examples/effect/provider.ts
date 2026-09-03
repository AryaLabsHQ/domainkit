// A provider is one value. Token-only providers skip OAuth; that is the whole difference.
import { Effect, Redacted, Schema } from "effect";
import { DnsRecord, DomainKitError, Provider } from "domainkit";

const Context = Schema.Struct({ apiKey: Schema.String });

export const porkbun = Provider.make({
  id: "porkbun",
  name: "Porkbun",
  context: Context,
  auth: {
    token: {
      label: "API key",
      docsUrl: "https://porkbun.com/account/api",
      requiredCapabilities: ["dns:read", "dns:write"],
      authenticate: (token) =>
        Effect.succeed({ secret: token, context: { apiKey: "pk1" }, expiresAt: null }),
    },
  },
  session: (credential) => ({
    capabilities: () => Effect.succeed(["dns:read", "dns:write"]),
    listTargets: () =>
      Effect.succeed([{ zone: "example.com", label: "example.com", context: credential.context }]),
    resolveTarget: (domain) =>
      Effect.succeed(
        Provider.Resolution.Resolved({
          target: {
            zone: domain.split(".").slice(-2).join("."),
            label: domain,
            context: credential.context,
          },
        }),
      ),
    dns: () => ({
      list: (zone) => porkbunApi(credential, "GET", `/dns/retrieve/${zone}`),
      create: (zone, record) => porkbunApi(credential, "POST", `/dns/create/${zone}`, record),
      get: (zone, id) => porkbunApi(credential, "GET", `/dns/retrieve/${zone}/${id}`),
      delete: (zone, id) =>
        porkbunApi(credential, "POST", `/dns/delete/${zone}/${id}`).pipe(Effect.asVoid),
    }),
  }),
});

// The same shape with OAuth added is Cloudflare; DomainKit handles redirect, callback, refresh, and revoke.

// Stand-in for the HTTP client this example does not ship; a real adapter decodes Porkbun's JSON here.
const rows = new Map<string, DnsRecord.DnsRecord>();
function porkbunApi<A>(
  credential: Provider.Credential,
  method: string,
  path: string,
  body?: DnsRecord.DnsRecord,
): Effect.Effect<A, DomainKitError.DomainKitError> {
  if (Redacted.value(credential.secret).length === 0) {
    return DomainKitError.fail(new DomainKitError.Unauthenticated({ message: "missing API key" }));
  }
  return Effect.sync(() => {
    const [, action, , id] = path.split("/");
    if (action === "create" && body !== undefined) {
      const providerRecordId = `pb-${rows.size + 1}`;
      rows.set(providerRecordId, body);
      return { providerRecordId } as A;
    }
    if (action === "retrieve" && id !== undefined) return (rows.get(id) ?? null) as A;
    if (action === "retrieve") {
      return [...rows].map(([providerRecordId, record]) => ({ record, providerRecordId })) as A;
    }
    if (id !== undefined) rows.delete(id);
    return undefined as A;
  });
}
