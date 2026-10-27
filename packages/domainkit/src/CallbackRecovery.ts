/** Browser-safe recovery hints for returning from an authenticated provider callback. */
import { Schema } from "effect";

export const Model = Schema.Struct({
  kind: Schema.Literals(["cancelled", "restart", "inspect"]),
  provider: Schema.String.check(Schema.isMinLength(1)),
  connectionId: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
});
export type Model = typeof Model.Type;

/** Reads a complete recovery hint; ignores missing, duplicate, or invalid metadata. */
export const read = (url: URL): Model | null => {
  const kinds = url.searchParams.getAll("domainkit");
  const providers = url.searchParams.getAll("domainkit-provider");
  const connections = url.searchParams.getAll("domainkit-connection");
  if (kinds.length !== 1 || providers.length !== 1 || connections.length > 1) return null;
  const outcome = {
    kind: kinds[0],
    provider: providers[0],
    ...(connections.length === 0 ? {} : { connectionId: connections[0] }),
  };
  return Schema.is(Model)(outcome) ? outcome : null;
};

/** Clones the URL and replaces or clears all recovery hints, preserving other parameters and hash. */
export const write = (url: URL, outcome: Model | null): URL => {
  const result = new URL(url);
  result.searchParams.delete("domainkit");
  result.searchParams.delete("domainkit-provider");
  result.searchParams.delete("domainkit-connection");
  if (outcome !== null) {
    result.searchParams.set("domainkit", outcome.kind);
    result.searchParams.set("domainkit-provider", outcome.provider);
    if (outcome.connectionId !== undefined)
      result.searchParams.set("domainkit-connection", outcome.connectionId);
  }
  return result;
};
