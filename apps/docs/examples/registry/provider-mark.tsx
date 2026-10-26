import { ProviderMark } from "../../registry/ui/provider-mark.tsx";

/** The default 32px mark and the two overrides a picker or a domain row passes. */
const sizes = [
  { className: "size-4", pixels: 16 },
  { className: "size-6", pixels: 24 },
  { className: undefined, pixels: 32 },
] as const;

export default function ProviderMarkExample() {
  return (
    <div className="grid w-full max-w-lg gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
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
      <div
        aria-label="Sizes"
        className="flex items-end gap-6 rounded-xl border border-border bg-card p-4 shadow-sm"
        role="group"
      >
        {sizes.map(({ className, pixels }) => (
          <div className="flex flex-col items-center gap-2" key={pixels}>
            <ProviderMark className={className} label="Cloudflare">
              <img alt="" src="https://integrations.sh/logo/cloudflare.com?sz=64" />
            </ProviderMark>
            <div className="text-xs text-muted-foreground tabular-nums">{pixels}px</div>
          </div>
        ))}
      </div>
    </div>
  );
}
