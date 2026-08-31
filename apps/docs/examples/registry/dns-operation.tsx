import { DnsOperation } from "../../registry/ui/dns-operation.tsx";

export default function DnsOperationExample() {
  return (
    <div className="grid gap-3">
      <DnsOperation
        action="Create"
        name="mail.example.com"
        priority={10}
        type="MX"
        value="feedback-smtp.example.net"
      />
      <DnsOperation
        action="No-op"
        name="mail.example.com"
        type="TXT"
        value="v=spf1 include:example.net ~all"
      />
      <DnsOperation
        action="Conflict"
        name="mail.example.com"
        reason="An incompatible value already exists."
        type="CNAME"
        value="app.example.net"
      />
    </div>
  );
}
