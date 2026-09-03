import * as DnsPacket from "@leichtgewicht/dns-packet";
import { Effect } from "effect";

import * as DnsRecord from "../DnsRecord.ts";
import * as DomainKitError from "../DomainKitError.ts";
import type { Fetch } from "./http.ts";

export interface Answer {
  readonly records: ReadonlyArray<DnsRecord.Observed>;
  readonly negative: boolean;
  readonly ttl: number | null;
}

const failed = (resolver: string, message: string) =>
  new DomainKitError.DomainKitError({
    reason: new DomainKitError.ResolverFailed({ resolver, message }),
  });

/** One RFC 8484 wire-format query; the caller applies the timeout. */
export const query = (input: {
  readonly resolver: string;
  readonly url: string;
  readonly fetch: Fetch;
  readonly name: string;
  readonly type: DnsRecord.Type;
  /** Host-supplied abort, combined with the fiber's own interruption signal. */
  readonly signal?: AbortSignal | undefined;
}): Effect.Effect<Answer, DomainKitError.DomainKitError> =>
  Effect.tryPromise({
    try: async (fiberSignal) => {
      const controller = new AbortController();
      const abort = (reason: unknown) => controller.abort(reason);
      fiberSignal.addEventListener("abort", () => abort(fiberSignal.reason), { once: true });
      input.signal?.addEventListener("abort", () => abort(input.signal?.reason), { once: true });
      if (input.signal?.aborted === true) abort(input.signal.reason);
      const signal = controller.signal;
      const body = Uint8Array.from(
        DnsPacket.encode({
          flags: DnsPacket.RECURSION_DESIRED,
          id: 0,
          questions: [{ name: input.name, type: input.type }],
          type: "query",
        }),
      );
      const response = await input.fetch(input.url, {
        body,
        headers: { accept: "application/dns-message", "content-type": "application/dns-message" },
        method: "POST",
        signal,
      });
      if (!response.ok) throw failed(input.resolver, `DoH returned HTTP ${response.status}`);
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/dns-message") {
        throw failed(
          input.resolver,
          `DoH returned unsupported content type ${contentType ?? "<missing>"}`,
        );
      }
      return decode(
        input.resolver,
        input.name,
        input.type,
        new Uint8Array(await response.arrayBuffer()),
      );
    },
    catch: (cause) =>
      DomainKitError.isDomainKitError(cause)
        ? cause
        : failed(input.resolver, cause instanceof Error ? cause.message : "DNS resolution failed"),
  });

function decode(resolver: string, name: string, type: DnsRecord.Type, message: Uint8Array): Answer {
  let packet: DnsPacket.Packet;
  try {
    packet = DnsPacket.decode(message);
  } catch {
    throw failed(resolver, "DoH returned an invalid DNS message");
  }
  if (packet.type !== "response") throw failed(resolver, "DoH returned a DNS query");
  if (packet.id !== 0) throw failed(resolver, "DoH response used an unexpected message ID");
  if (packet.flag_tc) throw failed(resolver, "DoH returned a truncated DNS response");
  const question = packet.questions?.[0];
  if (
    packet.questions?.length !== 1 ||
    question === undefined ||
    question.class !== "IN" ||
    question.type !== type ||
    question.name.toLowerCase().replace(/\.$/, "") !== name
  ) {
    throw failed(resolver, "DoH response did not match the DNS question");
  }
  if (packet.rcode === "NXDOMAIN") return { records: [], negative: true, ttl: null };
  if (packet.rcode !== "NOERROR") {
    throw failed(resolver, `DNS resolver returned ${packet.rcode ?? "an unknown response code"}`);
  }
  const answers = (packet.answers ?? []).filter((answer) => answer.class === "IN");
  if (answers.some((answer) => answer.ttl === undefined)) {
    throw failed(resolver, "DoH response omitted the DNS record TTL");
  }
  const records = answers.map(toRecord);
  const ttls = answers.flatMap((answer) => (answer.ttl === undefined ? [] : [answer.ttl]));
  return {
    records,
    negative: records.length === 0,
    ttl: ttls.length === 0 ? null : Math.min(...ttls),
  };
}

function toRecord(answer: DnsPacket.Answer): DnsRecord.Observed {
  const name = answer.name;
  const opaque = () => new DnsRecord.Opaque({ name, type: answer.type, raw: answer });
  const ttl = answer.ttl === undefined || answer.ttl <= 0 ? {} : { ttl: answer.ttl };
  try {
    switch (answer.type) {
      case "A":
        return DnsRecord.a({ name, address: answer.data, ...ttl });
      case "AAAA":
        return DnsRecord.aaaa({ name, address: answer.data, ...ttl });
      case "CNAME":
        return DnsRecord.cname({ name, target: answer.data, ...ttl });
      case "NS":
        return DnsRecord.ns({ name, nameserver: answer.data, ...ttl });
      case "TXT":
        return DnsRecord.txt({ name, value: decodeTxt(answer.data), ...ttl });
      case "MX":
        return DnsRecord.mx({
          name,
          exchange: answer.data.exchange,
          priority: answer.data.preference ?? 0,
          ...ttl,
        });
      case "CAA":
        return DnsRecord.caa({
          name,
          flags: answer.data.flags ?? 0,
          tag: answer.data.tag,
          value: answer.data.value,
          ...ttl,
        });
      case "SRV":
        return DnsRecord.srv({
          name,
          target: answer.data.target,
          port: required(answer.data.port),
          priority: answer.data.priority ?? 0,
          weight: answer.data.weight ?? 0,
          ...ttl,
        });
      default:
        return opaque();
    }
  } catch {
    return opaque();
  }
}

function required<A>(value: A | undefined): A {
  if (value === undefined) throw new Error("DoH answer omitted a required field");
  return value;
}

function decodeTxt(data: DnsPacket.TxtData): string {
  const chunks = Array.isArray(data) ? data : [data];
  const encoded = chunks.map((chunk) =>
    typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
  );
  const joined = new Uint8Array(encoded.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of encoded) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}
