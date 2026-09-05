/**
 * What a domain's requirements are, as data: the zone file they spell, the clipboard control a
 * value needs, and the standing one row reports. The table itself is the host's.
 */
import { DnsRecord, type Plan } from "domainkit";
import type { Transport } from "domainkit/client";
import { useEffect, useRef, useState } from "react";

export type Readiness = Transport.Readiness;
export type RequirementStatus = Readiness["requirements"][number]["status"];

// ---------------------------------------------------------------------------------------------
// Zone file
// ---------------------------------------------------------------------------------------------

const absolute = (value: string): string => (value.endsWith(".") ? value : `${value}.`);

const textEncoder = new TextEncoder();

const escapeTxtCharacter = (character: string): string => {
  if (character === '"' || character === "\\") return `\\${character}`;
  const codePoint = character.codePointAt(0);
  if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
    return `\\${codePoint.toString().padStart(3, "0")}`;
  }
  return character;
};

/** TXT strings are capped at 255 bytes each, so long values are split and quoted per chunk. */
const txtValue = (value: string): string => {
  const chunks: Array<string> = [];
  let chunk = "";
  let byteLength = 0;
  for (const character of value) {
    const characterByteLength = textEncoder.encode(character).byteLength;
    if (byteLength + characterByteLength > 255) {
      chunks.push(chunk);
      chunk = "";
      byteLength = 0;
    }
    chunk += escapeTxtCharacter(character);
    byteLength += characterByteLength;
  }
  chunks.push(chunk);
  return chunks.map((part) => `"${part}"`).join(" ");
};

/** The RR type as a zone file spells it. The tag and the type name are the same string. */
const rrType = (record: DnsRecord.Model): string => record._tag;

const zoneData = (record: DnsRecord.Model): string => {
  switch (record._tag) {
    case "A":
    case "AAAA":
      return record.address;
    case "CNAME":
      return absolute(record.target);
    case "NS":
      return absolute(record.nameserver);
    case "TXT":
      return txtValue(record.value);
    case "MX":
      return `${record.priority} ${absolute(record.exchange)}`;
    case "CAA":
      return `${record.flags} ${record.tag} "${record.value}"`;
    case "SRV":
      return `${record.priority} ${record.weight} ${record.port} ${absolute(record.target)}`;
  }
};

export const toZoneFile = (records: ReadonlyArray<DnsRecord.Model>): string =>
  `${records
    .map(
      (record) =>
        `${absolute(record.name)}${record.ttl === null ? "" : ` ${record.ttl}`} IN ${rrType(record)} ${zoneData(record)}`,
    )
    .join("\n")}\n`;

const downloadText = (filename: string, contents: string): void => {
  if (typeof document === "undefined") return;
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadZoneFile = (domain: string, records: ReadonlyArray<DnsRecord.Model>): void =>
  downloadText(`${domain}.txt`, toZoneFile(records));

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

export const copyText = (value: string): Promise<boolean> => {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(value).then(
    () => true,
    () => false,
  );
};

export interface CopyController {
  readonly copied: boolean;
  readonly copy: () => void;
}

export function useCopy(value: string, resetAfter = 2000): CopyController {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  return {
    copied,
    copy: () => {
      void copyText(value).then((ok) => {
        if (!ok) return;
        setCopied(true);
        clearTimeout(reset.current);
        reset.current = setTimeout(() => setCopied(false), resetAfter);
      });
    },
  };
}

/**
 * What a row has to say about one record: while a plan is pending it is what the plan will do to
 * it, and otherwise what the last observation read back.
 */
export type Standing =
  | { readonly _tag: "Operation"; readonly operation: Plan.Operation }
  | { readonly _tag: "Readiness"; readonly status: RequirementStatus };

export interface Sources {
  /** A plan still awaiting its apply. Pass `null` once one has landed; readiness answers then. */
  readonly plan?: Plan.Model | null | undefined;
  readonly readiness?: Readiness | null | undefined;
}

/** The row's standing, or `null` when neither a plan nor an observation covers the record. */
export const statusOf = (record: DnsRecord.Model, sources: Sources): Standing | null => {
  const operation = sources.plan?.operations.find((entry) =>
    DnsRecord.equals(entry.record, record),
  );
  if (operation !== undefined) return { _tag: "Operation", operation };
  const status = sources.readiness?.requirements.find((requirement) =>
    DnsRecord.equals(requirement.record, record),
  )?.status;
  return status === undefined ? null : { _tag: "Readiness", status };
};

/** A stable React key for a requirement: type, name, and data identify a record. */
export const identity = (record: DnsRecord.Model): string =>
  [rrType(record), record.name, DnsRecord.data(record)].join(":");

/**
 * A requirement set keyed by everything it carries, for memos that decide whether to re-send it.
 * `identity` is deliberately narrower: it answers "is this the same record" for a React key, while
 * a plan and an observation are built from `ttl`, `policy`, and `purpose` as well. `policy` in
 * particular decides whether a name may hold anything else, so readiness turns on it.
 */
export const requirementsKey = (records: ReadonlyArray<DnsRecord.Model>): string =>
  JSON.stringify(records);
