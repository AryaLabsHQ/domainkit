# 0002: Promise and Effect APIs

Status: Accepted

Effect-native services and typed failures are the canonical implementation model. They are exported
from `domainkit/effect`. The package root exposes a Promise API with equivalent domain values and
failures for hosts that do not use Effect.

Effect is a peer dependency so hosts control the compatible Effect 4 installation. Provider and host
interfaces remain implementable with ordinary TypeScript functions; adapters expose them as Layers
without requiring persistence implementations to use Effect internally.
