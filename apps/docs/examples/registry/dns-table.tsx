import { DnsStatus } from "../../registry/ui/dns-status.tsx";
import { DnsTable } from "../../registry/ui/dns-table.tsx";

export default function DnsTableExample() {
  return (
    <DnsTable
      records={[
        {
          id: "mx",
          name: "mail.example.com",
          priority: 10,
          status: <DnsStatus tone="success">Found</DnsStatus>,
          type: "MX",
          value: "feedback-smtp.example.net",
        },
        {
          id: "spf",
          name: "mail.example.com",
          status: <DnsStatus tone="warning">Pending</DnsStatus>,
          type: "TXT",
          value: "v=spf1 include:example.net ~all",
        },
      ]}
    />
  );
}
