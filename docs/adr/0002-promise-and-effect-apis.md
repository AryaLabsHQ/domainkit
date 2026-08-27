# 0002: Promise and Effect APIs

Status: Accepted

Effect-native services and typed failures are the canonical implementation model. They are exported
from `domainkit/effect`. The package root exposes a Promise API with equivalent domain values and
failures for hosts that do not use Effect.

Effect is a peer dependency so hosts control the compatible Effect 4 installation. Provider and host
interfaces remain implementable with ordinary TypeScript functions; adapters expose them as Layers
without requiring persistence implementations to use Effect internally.

`domainkit/effect` explicitly exports the canonical workflows and capability services. It does not
import or re-export the Promise facade. `domainkit` exposes mirrored standalone functions whose
signatures contain ordinary values, Promises, and async host interfaces; those functions build the
required Layers and call `Effect.runPromise` at the JavaScript boundary.

`Effect.tryPromise` is limited to unavoidable foreign seams: provider/store callbacks, Fetch and Web
Crypto, and `oauth4webapi`. Pure domain transformations remain plain TypeScript.
