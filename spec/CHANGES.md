# Contract changes

## 0.1 (2026-11-01)

First published version, written down from what a private operator and its apps already did:
`/ops/health`, `/ops/manifest` (components, context, tools, actions), `/ops/tools/<name>`,
`/ops/actions/<name>` with `dry_run`, `Idempotency-Key`, 409 and `verify`, `/ops/metrics`, heartbeats.

- `service` on a component names the host service that runs it; `launchd` stays as an older spelling.
- `contract` in the manifest says which version the app follows.
