import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import type { DnsRecord } from "./transport.ts";

export interface TableProps extends PartProps<"table", { readonly count: number }> {
  readonly records: ReadonlyArray<DnsRecord>;
}

export function Table({ records, ...props }: TableProps) {
  return usePart(
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
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.type}</td>
                <td>{record.name}</td>
                <td>
                  {record.priority === undefined ? "" : `${record.priority} `}
                  {record.value}
                </td>
              </tr>
            ))}
          </tbody>
        </>
      ),
      "data-domainkit-part": "records-table",
    },
  );
}

export const toZoneFile = (records: ReadonlyArray<DnsRecord>): string =>
  `${records
    .map(
      (record) =>
        `${record.name} IN ${record.type} ${record.priority === undefined ? "" : `${record.priority} `}${record.value}`,
    )
    .join("\n")}\n`;

export type { DnsRecord };
