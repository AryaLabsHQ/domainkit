# 0002: Promise and Effect APIs

Status: Accepted

Effect-native services and typed failures are the canonical implementation model. They are exported
from `domainkit/effect`. The package root exposes a Promise API with equivalent domain values and
failures for hosts that do not use Effect.

Effect is a peer dependency so hosts control the compatible Effect 4 installation. Provider and host
interfaces remain implementable with ordinary TypeScript functions; adapters expose them as Layers
without requiring persistence implementations to use Effect internally.

`domainkit/effect` exports canonical workflows and capability services as namespaces. Each service
module owns an `Interface`, a `Service` tag, and its Layers; public Effect programs use named
`Effect.fn` functions. It does not import or re-export the Promise facade. `domainkit` exposes
mirrored capability namespaces whose signatures contain ordinary values, Promises, and async host
interfaces. Those functions build the required Layers and call `Effect.runPromise` only at the
JavaScript boundary. There is no aggregate client or hidden runtime because DomainKit does not own
a default provider, credential store, or persistence graph.

`Effect.tryPromise` is limited to unavoidable foreign seams: provider/store callbacks, Fetch and Web
Crypto, and `oauth4webapi`. Unknown IO values are schema-decoded before entering domain logic;
canonical comparison and rendering remain pure TypeScript over decoded values.
