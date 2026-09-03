import { DnsOperation } from "../../registry/ui/dns-operation.tsx";

export default function DnsOperationExample() {
  return (
    <div className="grid gap-3">
      <DnsOperation
        name="app.example.com"
        operation="create"
        purpose="Serve your site"
        type="CNAME"
        value="edge.acme.dev"
      />
      <DnsOperation
        name="_acme.app.example.com"
        operation="noop"
        purpose="Prove ownership"
        type="TXT"
        value="acme-verify=7f3a"
      />
      <DnsOperation
        name="app.example.com"
        operation="conflict"
        reason="A CNAME cannot share a name with the existing A record."
        type="CNAME"
        value="edge.acme.dev"
      />
      <DnsOperation
        name="_acme.app.example.com"
        operation="delete"
        type="TXT"
        value="acme-verify=7f3a"
      />
    </div>
  );
}
