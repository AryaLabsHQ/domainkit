import { EmptyState, ErrorState, LoadingState } from "../../registry/ui/async-state.tsx";

export default function AsyncStateExample() {
  return (
    <div className="grid gap-3">
      <LoadingState>Checking DNS…</LoadingState>
      <EmptyState>No domains connected.</EmptyState>
      <ErrorState>Could not observe DNS.</ErrorState>
    </div>
  );
}
