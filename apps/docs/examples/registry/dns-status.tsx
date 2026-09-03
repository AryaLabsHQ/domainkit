import { DnsStatus } from "../../registry/ui/dns-status.tsx";

export default function DnsStatusExample() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DnsStatus status="satisfied" />
      <DnsStatus status="missing" />
      <DnsStatus status="mismatch" />
      <DnsStatus status="unknown" />
      <DnsStatus tone="warning">Checking again in 5 minutes</DnsStatus>
    </div>
  );
}
