import type { DnsRecord } from "../domain/dns-record.ts";
import { recordData, sameRecordData } from "../domain/dns-record.ts";
import type { PromiseDnsProvider as DnsProvider } from "../provider/provider.ts";
import { normalizeDnsData } from "./cloudflare-doh.ts";
import type { DnsResolver } from "./resolver.ts";

export type ProviderObservation =
  | { readonly _tag: "match" }
  | { readonly _tag: "missing" }
  | { readonly _tag: "mismatch"; readonly records: ReadonlyArray<DnsRecord> }
  | { readonly _tag: "failure"; readonly message: string };

export type PublicDnsObservation =
  | { readonly _tag: "propagated" }
  | { readonly _tag: "missing" }
  | { readonly _tag: "mismatch"; readonly answers: ReadonlyArray<string> }
  | { readonly _tag: "timeout" }
  | { readonly _tag: "failure"; readonly message: string };

export interface RecordVerification {
  readonly provider: ProviderObservation;
  readonly publicDns: PublicDnsObservation;
  readonly status: "verified" | "pending" | "mismatch" | "unavailable";
}

export async function verifyRecord(input: {
  readonly provider: DnsProvider;
  readonly record: DnsRecord;
  readonly resolver: DnsResolver;
  readonly zone: Parameters<DnsProvider["listRecords"]>[0];
}): Promise<RecordVerification> {
  const [provider, resolution] = await Promise.all([
    observeProvider(input.provider, input.zone, input.record),
    input.resolver.resolve({ name: input.record.name, type: input.record._tag }),
  ]);
  const expected = normalizeDnsData(input.record._tag, recordValue(input.record));
  const publicDns: PublicDnsObservation =
    resolution._tag === "answer"
      ? resolution.answers.some(
          (answer) =>
            answer.name === input.record.name &&
            answer.type === input.record._tag &&
            normalizeDnsData(answer.type, answer.data) === expected,
        )
        ? { _tag: "propagated" }
        : { _tag: "mismatch", answers: resolution.answers.map(({ data }) => data) }
      : resolution._tag === "nodata"
        ? { _tag: "missing" }
        : resolution;
  const status =
    provider._tag === "match" && publicDns._tag === "propagated"
      ? "verified"
      : provider._tag === "failure" || publicDns._tag === "failure" || publicDns._tag === "timeout"
        ? "unavailable"
        : provider._tag === "mismatch" || publicDns._tag === "mismatch"
          ? "mismatch"
          : "pending";
  return { provider, publicDns, status };
}

async function observeProvider(
  provider: DnsProvider,
  zone: Parameters<DnsProvider["listRecords"]>[0],
  record: DnsRecord,
): Promise<ProviderObservation> {
  try {
    const records = await provider.listRecords(zone);
    if (records.some((existing) => sameRecordData(existing, record))) return { _tag: "match" };
    const sameSet = records.filter(
      (existing) => existing.name === record.name && existing._tag === record._tag,
    );
    return sameSet.length === 0 ? { _tag: "missing" } : { _tag: "mismatch", records: sameSet };
  } catch (cause) {
    return {
      _tag: "failure",
      message: cause instanceof Error ? cause.name : "Provider readback failed",
    };
  }
}

function recordValue(record: DnsRecord): string {
  const data = recordData(record);
  switch (record._tag) {
    case "A":
    case "AAAA":
      return String(data.address);
    case "CNAME":
    case "NS":
      return String(data.target);
    case "TXT":
      return String(data.value);
    case "MX":
      return `${data.priority} ${data.exchange}`;
    case "CAA":
      return `${data.flags} ${data.tag} ${data.value}`;
    case "SRV":
      return `${data.priority} ${data.weight} ${data.port} ${data.target}`;
  }
}
