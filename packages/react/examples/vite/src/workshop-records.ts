import type { Transport } from "domainkit";

export const nextRecordId = (
  records: Readonly<Record<string, Transport.DnsRecord>>,
  start: number,
): { readonly id: string; readonly next: number } => {
  let sequence = start;
  while (Object.hasOwn(records, `record-${sequence}`)) sequence += 1;
  return { id: `record-${sequence}`, next: sequence + 1 };
};
