import { CopyValue } from "../../registry/ui/copy-value.tsx";

export default function CopyValueExample() {
  return (
    <div className="grid gap-3 text-sm">
      <CopyValue value="edge.acme.dev" />
      <CopyValue value="acme-verify=7f3a" />
    </div>
  );
}
