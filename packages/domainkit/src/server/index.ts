import { Context, Crypto, Effect, Layer, ManagedRuntime, Schema } from "effect";

import * as Connection from "../auth/connection-api.ts";
import * as Lifecycle from "../auth/lifecycle-repository.ts";

export const DEFAULT_BASE_PATH = "/api/domainkit";

export class Error extends Schema.TaggedError<Error>()("DomainKitServerError", {
  category: Schema.Literals(["authentication", "configuration", "provider", "request", "storage"]),
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export interface Principal {
  readonly authorizedById: string;
  readonly ownerId: string;
}

export interface IdentityInterface {
  readonly authenticate: (request: Request) => Effect.Effect<Principal, Error>;
}

export class Identity extends Context.Service<Identity, IdentityInterface>()(
  "@domainkit/server/Identity",
) {}

export interface InteractiveFlowInput {
  readonly callbackUrl: URL;
  readonly domain: string | undefined;
  readonly method: "integration" | "oauth2";
  readonly providerId: string;
}

export interface ProvidersInterface {
  readonly interactiveFlow: (
    input: InteractiveFlowInput,
  ) => Effect.Effect<Connection.InteractiveFlow, Error>;
}

export class Providers extends Context.Service<Providers, ProvidersInterface>()(
  "@domainkit/server/Providers",
) {}

export interface InteractiveProvider {
  readonly create: (
    input: Omit<InteractiveFlowInput, "method" | "providerId">,
  ) => Effect.Effect<Connection.InteractiveFlow, Error>;
  readonly method: "integration" | "oauth2";
  readonly providerId: string;
}

/** Configure all interactive providers once at the host composition root. */
export const providersLayer = (
  definitions: ReadonlyArray<InteractiveProvider>,
): Layer.Layer<Providers> => {
  const providers = new Map<string, InteractiveProvider>();
  for (const definition of definitions) {
    const key = `${definition.providerId}:${definition.method}`;
    if (providers.has(key)) {
      throw new globalThis.Error(`Interactive provider ${key} is configured more than once`);
    }
    providers.set(key, definition);
  }
  return Layer.succeed(Providers)({
    interactiveFlow: (input) => {
      const provider = providers.get(`${input.providerId}:${input.method}`);
      return provider === undefined
        ? Effect.fail(
            new Error({
              category: "provider",
              message: `Interactive provider ${input.providerId}:${input.method} is not configured`,
              operation: "Server.Providers.interactiveFlow",
              retry: "never",
            }),
          )
        : provider.create({ callbackUrl: input.callbackUrl, domain: input.domain });
    },
  });
};

export interface PendingAuthorizationContext {
  readonly baseURL: string;
  readonly domain: string | undefined;
  readonly method: "integration" | "oauth2";
  readonly providerId: string;
  readonly returnTo: string;
}

export interface PendingAuthorization {
  readonly context: PendingAuthorizationContext;
  readonly continuation: Connection.Continuation;
}

export interface PendingAuthorizationsInterface {
  readonly consume: (id: string, now: Date) => Effect.Effect<PendingAuthorization | null, Error>;
  readonly get: (id: string, now: Date) => Effect.Effect<PendingAuthorization | null, Error>;
  readonly put: (pending: PendingAuthorization) => Effect.Effect<void, Error>;
}

export class PendingAuthorizations extends Context.Service<
  PendingAuthorizations,
  PendingAuthorizationsInterface
>()("@domainkit/server/PendingAuthorizations") {}

export interface Configuration {
  /** Public origin used to construct provider callbacks. Defaults to the incoming request origin. */
  readonly baseURL?: string;
  /** Catch-all mount path. */
  readonly basePath?: string;
  /** Relative same-origin destination used when a start request omits `returnTo`. */
  readonly defaultReturnTo?: string;
}

export interface Interface {
  readonly handle: (request: Request) => Effect.Effect<Response>;
}

export class Handler extends Context.Service<Handler, Interface>()("@domainkit/server/Handler") {}

interface StartInput {
  readonly authorizationId?: string;
  readonly domain?: string;
  readonly method: "integration" | "oauth2";
  readonly providerId: string;
  readonly returnTo?: string;
}

const requestError = (operation: string, message: string) =>
  new Error({ category: "request", message, operation, retry: "after-user-action" });

const connectionError = (operation: string, cause: Error) =>
  new Connection.Error({
    category: cause.category === "provider" ? "provider" : "authorization",
    message: cause.message,
    operation,
    retry: cause.retry,
  });

const serverError = (operation: string, cause: unknown): Error => {
  if (cause instanceof Error) return cause;
  if (cause instanceof Connection.Error) {
    return new Error({
      category: cause.category === "provider" ? "provider" : "request",
      message: cause.message,
      operation,
      retry: cause.retry,
    });
  }
  if (cause instanceof Lifecycle.Error) {
    return new Error({
      category: "storage",
      message: cause.message,
      operation,
      retry: cause.retry,
    });
  }
  return new Error({
    category: "provider",
    message: cause instanceof globalThis.Error ? cause.message : "Domain connection failed",
    operation,
    retry: "unknown",
  });
};

const normalizeBasePath = (input: string | undefined): string => {
  const path = input ?? DEFAULT_BASE_PATH;
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new globalThis.Error("DomainKit server basePath must be an absolute path");
  }
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
};

const configuredBaseUrl = (input: string | undefined): URL | undefined => {
  if (input === undefined) return undefined;
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new globalThis.Error("DomainKit server baseURL must use http or https");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
};

const canonicalReturnTo = Effect.fn("Server.canonicalReturnTo")((input: string, baseUrl: URL) =>
  Effect.try({
    try: () => new URL(input, baseUrl),
    catch: () => requestError("Server.start", "returnTo must be a valid application URL"),
  }).pipe(
    Effect.filterOrFail(
      (target) => target.origin === baseUrl.origin,
      () => requestError("Server.start", "returnTo must stay on the configured application origin"),
    ),
    Effect.map((target) => `${target.pathname}${target.search}${target.hash}`),
  ),
);

const parseStartInput = Effect.fn("Server.parseStartInput")((request: Request) =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: () => requestError("Server.start", "Request body must be valid JSON"),
  }).pipe(
    Effect.flatMap((input) => {
      if (typeof input !== "object" || input === null) {
        return Effect.fail(requestError("Server.start", "Request body must be an object"));
      }
      const value = input as Record<string, unknown>;
      if (
        typeof value.providerId !== "string" ||
        !/^[a-z0-9][a-z0-9._-]*$/.test(value.providerId) ||
        (value.method !== "oauth2" && value.method !== "integration") ||
        (value.domain !== undefined && typeof value.domain !== "string") ||
        (value.returnTo !== undefined && typeof value.returnTo !== "string") ||
        (value.authorizationId !== undefined && typeof value.authorizationId !== "string")
      ) {
        return Effect.fail(
          requestError(
            "Server.start",
            "providerId and a supported interactive method are required",
          ),
        );
      }
      return Effect.succeed({
        ...(value.authorizationId === undefined ? {} : { authorizationId: value.authorizationId }),
        ...(value.domain === undefined ? {} : { domain: value.domain }),
        method: value.method,
        providerId: value.providerId,
        ...(value.returnTo === undefined ? {} : { returnTo: value.returnTo }),
      } satisfies StartInput);
    }),
  ),
);

const jsonError = (cause: Error): Response =>
  Response.json(
    {
      error: {
        category: cause.category,
        message: cause.message,
        operation: cause.operation,
        retry: cause.retry,
      },
    },
    { status: cause.category === "authentication" ? 401 : 400 },
  );

export const layer = (configuration: Configuration = {}) =>
  Layer.effect(
    Handler,
    Effect.gen(function* () {
      const identity = yield* Identity;
      const providers = yield* Providers;
      const pending = yield* PendingAuthorizations;
      const repository = yield* Lifecycle.Service;
      const crypto = yield* Crypto.Crypto;
      const basePath = normalizeBasePath(configuration.basePath);
      const fixedBaseUrl = configuredBaseUrl(configuration.baseURL);
      const defaultReturnTo = configuration.defaultReturnTo ?? "/";

      const withCore = <A, E>(effect: Effect.Effect<A, E, Lifecycle.Service | Crypto.Crypto>) =>
        effect.pipe(
          Effect.provideService(Lifecycle.Service, repository),
          Effect.provideService(Crypto.Crypto, crypto),
        );

      const start = Effect.fn("Server.start")(function* (request: Request) {
        const principal = yield* identity.authenticate(request);
        const input = yield* parseStartInput(request);
        const requestUrl = new URL(request.url);
        const baseUrl = fixedBaseUrl ?? new URL(requestUrl.origin);
        const callbackUrl = new URL(
          `${basePath}/callback/${encodeURIComponent(input.providerId)}`,
          baseUrl,
        );
        const returnTo = yield* canonicalReturnTo(input.returnTo ?? defaultReturnTo, baseUrl);
        const flow = yield* providers.interactiveFlow({
          callbackUrl,
          domain: input.domain,
          method: input.method,
          providerId: input.providerId,
        });
        if (flow.providerId !== input.providerId || flow.method !== input.method) {
          return yield* requestError(
            "Server.start",
            "Configured provider flow does not match the requested provider and method",
          );
        }
        const continuations: Connection.ContinuationStore = {
          consume: () => Effect.succeed(null),
          put: (continuation) =>
            pending
              .put({
                context: {
                  baseURL: baseUrl.origin,
                  domain: input.domain,
                  method: input.method,
                  providerId: input.providerId,
                  returnTo,
                },
                continuation,
              })
              .pipe(Effect.mapError((cause) => connectionError("Server.pending.put", cause))),
        };
        const result = yield* withCore(
          Connection.start({
            authorizedById: principal.authorizedById,
            ...(input.authorizationId === undefined
              ? {}
              : { authorizationId: input.authorizationId }),
            method: Connection.Method.Interactive({ continuations, flow }),
            ownerId: principal.ownerId,
          }),
        );
        if (result._tag !== "Redirect") {
          return yield* requestError("Server.start", "Interactive connection did not redirect");
        }
        return Response.json({
          authorizationUrl: result.authorizationUrl.toString(),
          continuationId: result.continuationId,
        });
      });

      const complete = Effect.fn("Server.complete")(function* (
        request: Request,
        providerId: string,
      ) {
        const callbackUrl = new URL(request.url);
        const continuationId = callbackUrl.searchParams.get("state");
        if (continuationId === null || continuationId.length === 0) {
          return yield* requestError("Server.complete", "Provider callback is missing state");
        }
        const now = new Date();
        const stored = yield* pending.get(continuationId, now);
        if (stored === null) {
          return yield* requestError(
            "Server.complete",
            "Connection continuation is expired, unknown, or already consumed",
          );
        }
        if (stored.context.providerId !== providerId) {
          return yield* requestError(
            "Server.complete",
            "Provider callback does not match its continuation",
          );
        }
        const callbackBaseUrl = yield* Effect.try({
          try: () => configuredBaseUrl(stored.context.baseURL),
          catch: () =>
            new Error({
              category: "storage",
              message: "Stored provider callback origin is invalid",
              operation: "Server.complete",
              retry: "never",
            }),
        }).pipe(
          Effect.flatMap((value) =>
            value === undefined
              ? Effect.fail(
                  new Error({
                    category: "storage",
                    message: "Stored provider callback origin is missing",
                    operation: "Server.complete",
                    retry: "never",
                  }),
                )
              : Effect.succeed(value),
          ),
        );
        if (fixedBaseUrl !== undefined && callbackBaseUrl.origin !== fixedBaseUrl.origin) {
          return yield* requestError(
            "Server.complete",
            "Provider callback does not match the configured application origin",
          );
        }
        const expectedCallback = new URL(
          `${basePath}/callback/${encodeURIComponent(providerId)}`,
          callbackBaseUrl,
        );
        if (
          callbackUrl.origin !== expectedCallback.origin ||
          callbackUrl.pathname !== expectedCallback.pathname
        ) {
          return yield* requestError("Server.complete", "Provider callback URL is invalid");
        }
        const flow = yield* providers.interactiveFlow({
          callbackUrl: expectedCallback,
          domain: stored.context.domain,
          method: stored.context.method,
          providerId,
        });
        if (flow.providerId !== providerId || flow.method !== stored.context.method) {
          return yield* requestError(
            "Server.complete",
            "Configured provider flow does not match the stored continuation",
          );
        }
        const continuations: Connection.ContinuationStore = {
          consume: (id, consumedAt) =>
            pending.consume(id, consumedAt).pipe(
              Effect.map((value) => value?.continuation ?? null),
              Effect.mapError((cause) => connectionError("Server.pending.consume", cause)),
            ),
          put: () => Effect.die("Callback continuation store cannot put"),
        };
        const connection = yield* withCore(
          Connection.complete({ callbackUrl, continuationId, continuations, flow }),
        );
        const returnTo = yield* canonicalReturnTo(stored.context.returnTo, callbackBaseUrl);
        const destination = new URL(returnTo, callbackBaseUrl);
        destination.searchParams.set("domainkit", "connected");
        destination.searchParams.set("connectionId", connection.id);
        return new Response(null, { headers: { location: destination.toString() }, status: 303 });
      });

      const handle = (request: Request): Effect.Effect<Response> => {
        const url = new URL(request.url);
        const callbackPrefix = `${basePath}/callback/`;
        const route =
          request.method === "POST" && url.pathname === `${basePath}/connection/start`
            ? start(request)
            : request.method === "GET" && url.pathname.startsWith(callbackPrefix)
              ? complete(request, url.pathname.slice(callbackPrefix.length))
              : Effect.succeed(Response.json({ error: { message: "Not found" } }, { status: 404 }));
        return route.pipe(
          Effect.mapError((cause) => serverError("Server.handle", cause)),
          Effect.catch((cause) => Effect.succeed(jsonError(cause))),
        );
      };

      return Handler.of({ handle });
    }),
  );

export interface WebHandler {
  readonly dispose: () => Promise<void>;
  readonly fetch: (request: Request) => Promise<Response>;
}

/** Build one reusable Web handler from a fully provided Effect server Layer. */
export function toWebHandler<E>(serverLayer: Layer.Layer<Handler, E>): WebHandler {
  const runtime = ManagedRuntime.make(serverLayer);
  return {
    dispose: () => runtime.dispose(),
    fetch: (request) =>
      runtime.runPromise(Effect.flatMap(Handler, (handler) => handler.handle(request))),
  };
}
