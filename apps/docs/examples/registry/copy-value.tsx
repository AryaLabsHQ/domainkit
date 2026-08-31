import { CopyValue } from "../../registry/ui/copy-value.tsx";

export default function CopyValueExample() {
  return (
    <div className="grid gap-3 text-sm">
      <CopyValue value="feedback-smtp.example.net" />
      <CopyValue value="v=spf1 include:example.net ~all" />
    </div>
  );
}
