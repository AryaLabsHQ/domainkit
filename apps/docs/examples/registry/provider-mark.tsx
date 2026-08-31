import { ProviderMark } from "../../registry/ui/provider-mark.tsx";

export default function ProviderMarkExample() {
  return (
    <div className="grid w-full max-w-lg gap-3 sm:grid-cols-2">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <ProviderMark label="Cloudflare">
          <img alt="" src="https://integrations.sh/logo/cloudflare.com?sz=64" />
        </ProviderMark>
        <div>
          <div className="text-sm font-medium">Cloudflare</div>
          <div className="text-xs text-muted-foreground">DNS provider</div>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <ProviderMark label="Vercel">
          <img alt="" src="https://integrations.sh/logo/vercel.com?sz=64" />
        </ProviderMark>
        <div>
          <div className="text-sm font-medium">Vercel</div>
          <div className="text-xs text-muted-foreground">DNS provider</div>
        </div>
      </div>
    </div>
  );
}
