import { DnsStatus } from "../../registry/ui/dns-status.tsx";

export default function DnsStatusExample() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DnsStatus>Not checked</DnsStatus>
      <DnsStatus tone="success">Found</DnsStatus>
      <DnsStatus tone="warning">Pending</DnsStatus>
      <DnsStatus tone="danger">Mismatch</DnsStatus>
    </div>
  );
}
