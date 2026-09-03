import { DnsStatus } from "../../registry/ui/dns-status.tsx";
import { DnsTable } from "../../registry/ui/dns-table.tsx";

export default function DnsTableExample() {
  return (
    <DnsTable
      records={[
        {
          id: "cname",
          name: "app.example.com",
          purpose: "Serve your site",
          status: <DnsStatus status="satisfied" />,
          type: "CNAME",
          value: "edge.acme.dev",
        },
        {
          id: "txt",
          name: "_acme.app.example.com",
          purpose: "Prove ownership",
          status: <DnsStatus status="missing" />,
          type: "TXT",
          value: "acme-verify=7f3a",
        },
      ]}
    />
  );
}
