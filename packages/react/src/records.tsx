import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import type { DnsRecord, ObservationEvidence } from "./transport.ts";

const copyText = (value: string): Promise<boolean> => {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(value).then(
    () => true,
    () => false,
  );
};

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

const absoluteDomainName = (value: string): string => (value.endsWith(".") ? value : `${value}.`);

const textEncoder = new TextEncoder();

const escapeTxtCharacter = (character: string): string => {
  if (character === '"' || character === "\\") return `\\${character}`;
  const codePoint = character.codePointAt(0);
  if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
    return `\\${codePoint.toString().padStart(3, "0")}`;
  }
  return character;
};

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

const srvValue = (value: string): string => {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 3) throw new Error(`Invalid SRV value: ${value}`);
  const [weight, port, target] = fields;
  if (weight === undefined || port === undefined || target === undefined) {
    throw new Error(`Invalid SRV value: ${value}`);
  }
  return `${weight} ${port} ${absoluteDomainName(target)}`;
};

const zoneValue = (record: DnsRecord): string => {
  switch (record.type.toUpperCase()) {
    case "CNAME":
    case "MX":
    case "NS":
    case "PTR":
      return absoluteDomainName(record.value);
    case "SRV":
      return srvValue(record.value);
    case "TXT":
      return txtValue(record.value);
    default:
      return record.value;
  }
};

export interface CopyValueProps extends PartProps<"span", { readonly copied: boolean }> {
  readonly copiedLabel?: string;
  readonly copyLabel?: string;
  readonly value: string;
}

export function CopyValue({
  copiedLabel = "Copied",
  copyLabel = "Copy",
  value,
  ...props
}: CopyValueProps) {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  return usePart(
    "span",
    props,
    { copied },
    {
      children: (
        <>
          <code>{value}</code>
          <button
            aria-label={`${copied ? copiedLabel : copyLabel} ${value}`}
            data-domainkit-part="copy-action"
            onClick={() => {
              void copyText(value).then((ok) => {
                if (!ok) return;
                setCopied(true);
                clearTimeout(reset.current);
                reset.current = setTimeout(() => setCopied(false), 2000);
              });
            }}
            type="button"
          >
            <span aria-hidden="true" data-domainkit-part="copy-glyph" data-state="idle">
              <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={2} />
            </span>
            <span aria-hidden="true" data-domainkit-part="copy-glyph" data-state="done">
              <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
            </span>
          </button>
        </>
      ),
      "data-copied": copied ? "" : undefined,
      "data-domainkit-part": "copy-value",
    },
  );
}

export interface ZoneFileProps extends PartProps<"div", { readonly count: number }> {
  readonly copiedLabel?: string;
  readonly copyLabel?: string;
  readonly domain: string;
  readonly downloadLabel?: string;
  readonly records: ReadonlyArray<DnsRecord>;
}

export function ZoneFile({
  copiedLabel = "Copied",
  copyLabel = "Copy zone",
  domain,
  downloadLabel = "Download",
  records,
  ...props
}: ZoneFileProps) {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const zone = toZoneFile(records);
  useEffect(() => () => clearTimeout(reset.current), []);
  return usePart(
    "div",
    props,
    { count: records.length },
    {
      children: (
        <>
          <button
            aria-label={copied ? copiedLabel : copyLabel}
            data-domainkit-part="zone-copy"
            onClick={() => {
              void copyText(zone).then((ok) => {
                if (!ok) return;
                setCopied(true);
                clearTimeout(reset.current);
                reset.current = setTimeout(() => setCopied(false), 2000);
              });
            }}
            type="button"
          >
            {copied ? copiedLabel : copyLabel}
          </button>
          <button
            data-domainkit-part="zone-download"
            onClick={() => downloadText(`${domain}.txt`, zone)}
            type="button"
          >
            {downloadLabel}
          </button>
        </>
      ),
      "data-domainkit-part": "zone-file",
    },
  );
}

export interface StatusProps extends PartProps<
  "span",
  { readonly status: ObservationEvidence["_tag"] }
> {
  readonly evidence: ObservationEvidence;
}

export function Status({ evidence, ...props }: StatusProps) {
  return usePart(
    "span",
    props,
    { status: evidence._tag },
    {
      children: evidence._tag,
      "data-domainkit-part": "record-status",
      "data-status": evidence._tag,
    },
  );
}

export interface CardProps extends PartProps<"section", { readonly recordId: string }> {
  readonly evidence?: ReadonlyArray<ObservationEvidence>;
  readonly record: DnsRecord;
}

export function Card({ evidence, record, ...props }: CardProps) {
  const matching =
    evidence === undefined ? [] : evidence.filter((item) => item.recordId === record.id);
  return usePart(
    "section",
    props,
    { recordId: record.id },
    {
      children: (
        <>
          <div data-domainkit-part="record-card-head">
            <strong>{record.type}</strong>
            {matching.map((item, index) => (
              <Status evidence={item} key={`${item._tag}-${index}`} />
            ))}
          </div>
          <dl>
            <div>
              <dt>Name</dt>
              <dd>
                <CopyValue value={record.name} />
              </dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd>
                {record.priority === undefined ? null : (
                  <span data-domainkit-part="record-priority">Priority {record.priority}</span>
                )}
                <CopyValue value={record.value} />
              </dd>
            </div>
          </dl>
        </>
      ),
      "data-domainkit-part": "record-card",
    },
  );
}

export interface TableProps extends PartProps<"table", { readonly count: number }> {
  readonly evidence?: ReadonlyArray<ObservationEvidence>;
  readonly records: ReadonlyArray<DnsRecord>;
}

export function Table({ evidence, records, ...props }: TableProps) {
  return (
    <div data-domainkit-part="records-panel">
      {usePart(
        "table",
        props,
        { count: records.length },
        {
          children: (
            <>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Name</th>
                  <th scope="col">Value</th>
                  {evidence === undefined ? null : (
                    <th data-domainkit-part="records-status" scope="col">
                      Status
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.type}</td>
                    <td>
                      <CopyValue value={record.name} />
                    </td>
                    <td>
                      <span data-domainkit-part="record-value">
                        {record.priority === undefined ? null : (
                          <span data-domainkit-part="record-priority">{record.priority}</span>
                        )}
                        <CopyValue value={record.value} />
                      </span>
                    </td>
                    {evidence === undefined ? null : (
                      <td data-domainkit-part="records-status">
                        {evidence
                          .filter((item) => item.recordId === record.id)
                          .map((item, index) => (
                            <Status evidence={item} key={`${item._tag}-${index}`} />
                          ))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </>
          ),
          "data-domainkit-part": "records-table",
        },
      )}
    </div>
  );
}

export const toZoneFile = (records: ReadonlyArray<DnsRecord>): string =>
  `${records
    .map(
      (record) =>
        `${absoluteDomainName(record.name)} IN ${record.type} ${record.priority === undefined ? "" : `${record.priority} `}${zoneValue(record)}`,
    )
    .join("\n")}\n`;

export type { DnsRecord, ObservationEvidence };
