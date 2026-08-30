import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { Transport } from "domainkit";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useIcons } from "./icons.tsx";

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

const zoneValue = (record: Transport.DnsRecord): string => {
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

type LeafState = Record<string, unknown>;

function leafPart<Tag extends keyof React.JSX.IntrinsicElements>(
  defaultTagName: Tag,
  part: string,
) {
  return function Leaf(props: PartProps<Tag, LeafState>): ReactElement {
    return usePart(defaultTagName, props, {}, { "data-domainkit-part": part });
  };
}

export interface CopyValueProps extends PartProps<"span", { readonly copied: boolean }> {
  readonly copiedIcon?: ReactNode;
  readonly copiedLabel?: string;
  readonly copyIcon?: ReactNode;
  readonly copyLabel?: string;
  readonly value: string;
}

export function CopyValue({
  copiedIcon,
  copiedLabel = "Copied",
  copyIcon,
  copyLabel = "Copy",
  value,
  ...props
}: CopyValueProps) {
  const icons = useIcons();
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
            <span
              aria-hidden="true"
              data-domainkit-part="copy-glyph"
              data-icon=""
              data-state="idle"
            >
              {copyIcon ?? icons.copy}
            </span>
            <span
              aria-hidden="true"
              data-domainkit-part="copy-glyph"
              data-icon=""
              data-state="done"
            >
              {copiedIcon ?? icons.copied}
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
  readonly copiedIcon?: ReactNode;
  readonly copiedLabel?: string;
  readonly copyIcon?: ReactNode;
  readonly copyLabel?: string;
  readonly domain: string;
  readonly downloadIcon?: ReactNode;
  readonly downloadLabel?: string;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
}

export function ZoneFile({
  copiedIcon,
  copiedLabel = "Copied",
  copyIcon,
  copyLabel = "Copy zone",
  domain,
  downloadIcon,
  downloadLabel = "Download",
  records,
  ...props
}: ZoneFileProps) {
  const icons = useIcons();
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
            <span aria-hidden="true" data-icon="inline-start">
              {copied ? (copiedIcon ?? icons.copied) : (copyIcon ?? icons.copy)}
            </span>
            {copied ? copiedLabel : copyLabel}
          </button>
          <button
            data-domainkit-part="zone-download"
            onClick={() => downloadText(`${domain}.txt`, zone)}
            type="button"
          >
            <span aria-hidden="true" data-icon="inline-start">
              {downloadIcon ?? icons.download}
            </span>
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
  { readonly status: Transport.ObservationEvidence["_tag"] }
> {
  readonly evidence: Transport.ObservationEvidence;
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

export interface PriorityProps extends PartProps<"span", { readonly priority: number }> {
  readonly priority?: number;
}

export function Priority({ children, priority = 0, ...props }: PriorityProps) {
  return usePart(
    "span",
    props,
    { priority },
    {
      children: children ?? `Priority ${priority}`,
      "data-domainkit-part": "record-priority",
    },
  );
}

export const Header = leafPart("thead", "records-header");
export const Body = leafPart("tbody", "records-body");
export const Footer = leafPart("tfoot", "records-footer");
export const Row = leafPart("tr", "records-row");
export const Head = leafPart("th", "records-head");
export const Cell = leafPart("td", "records-cell");
export const Caption = leafPart("caption", "records-caption");
export const Value = leafPart("span", "record-value");
export const CardHeader = leafPart("div", "record-card-head");
export const CardTitle = leafPart("strong", "record-card-title");
export const CardContent = leafPart("dl", "record-card-content");

export interface RootProps extends PartProps<"table", { readonly count: number }> {
  readonly count?: number;
}

export function Root({ count = 0, ...props }: RootProps) {
  return (
    <div data-domainkit-part="records-panel">
      {usePart("table", props, { count }, { "data-domainkit-part": "records-table" })}
    </div>
  );
}

export interface CardProps extends PartProps<"section", { readonly recordId: string }> {
  readonly copiedIcon?: ReactNode;
  readonly copyIcon?: ReactNode;
  readonly evidence?: ReadonlyArray<Transport.ObservationEvidence>;
  readonly record: Transport.DnsRecord;
}

export function Card({ copiedIcon, copyIcon, evidence, record, ...props }: CardProps) {
  const matching =
    evidence === undefined ? [] : evidence.filter((item) => item.recordId === record.id);
  return usePart(
    "section",
    props,
    { recordId: record.id },
    {
      children: (
        <>
          <CardHeader>
            <CardTitle>{record.type}</CardTitle>
            {matching.map((item, index) => (
              <Status evidence={item} key={`${item._tag}-${index}`} />
            ))}
          </CardHeader>
          <CardContent>
            <div>
              <dt>Name</dt>
              <dd>
                <CopyValue copiedIcon={copiedIcon} copyIcon={copyIcon} value={record.name} />
              </dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd>
                <CopyValue copiedIcon={copiedIcon} copyIcon={copyIcon} value={record.value} />
                {record.priority === undefined ? null : <Priority priority={record.priority} />}
              </dd>
            </div>
          </CardContent>
        </>
      ),
      "data-domainkit-part": "record-card",
    },
  );
}

export interface TableProps extends PartProps<"table", { readonly count: number }> {
  readonly copiedIcon?: ReactNode;
  readonly copyIcon?: ReactNode;
  readonly evidence?: ReadonlyArray<Transport.ObservationEvidence>;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
}

export function Table({ copiedIcon, copyIcon, evidence, records, ...props }: TableProps) {
  const status = evidence !== undefined;
  return (
    <Root count={records.length} {...props}>
      <Header>
        <Row>
          <Head scope="col">Type</Head>
          <Head scope="col">Name</Head>
          <Head scope="col">Value</Head>
          {status ? (
            <Head data-column="status" scope="col">
              Status
            </Head>
          ) : null}
        </Row>
      </Header>
      <Body>
        {records.map((record) => (
          <Row key={record.id}>
            <Cell>{record.type}</Cell>
            <Cell>
              <CopyValue copiedIcon={copiedIcon} copyIcon={copyIcon} value={record.name} />
            </Cell>
            <Cell>
              <Value>
                <CopyValue copiedIcon={copiedIcon} copyIcon={copyIcon} value={record.value} />
                {record.priority === undefined ? null : <Priority priority={record.priority} />}
              </Value>
            </Cell>
            {status ? (
              <Cell data-column="status">
                {evidence
                  .filter((item) => item.recordId === record.id)
                  .map((item, index) => (
                    <Status evidence={item} key={`${item._tag}-${index}`} />
                  ))}
              </Cell>
            ) : null}
          </Row>
        ))}
      </Body>
    </Root>
  );
}

export const toZoneFile = (records: ReadonlyArray<Transport.DnsRecord>): string =>
  `${records
    .map(
      (record) =>
        `${absoluteDomainName(record.name)} IN ${record.type} ${record.priority === undefined ? "" : `${record.priority} `}${zoneValue(record)}`,
    )
    .join("\n")}\n`;

export type DnsRecord = Transport.DnsRecord;
export type ObservationEvidence = Transport.ObservationEvidence;
