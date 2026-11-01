# Contract changes

## 0.2 (2026-11-01)

- **Speed**: apps with long work record each run and its steps, judge them with the check `slow`
  (per unit, against their own baseline), may declare `operations` in the manifest, and offer a
  `timings` tool. Added after a search that took 5 minutes because one step waited 25 s for each
  stay with no prices, while the outside services answered in milliseconds. Additive: a 0.1 app is
  a valid 0.2 app.

## 0.1 (2026-11-01)

First published version, written down from what a private operator and its apps already did:
`/ops/health`, `/ops/manifest` (components, context, tools, actions), `/ops/tools/<name>`,
`/ops/actions/<name>` with `dry_run`, `Idempotency-Key`, 409 and `verify`, `/ops/metrics`, heartbeats.

- `service` on a component names the host service that runs it; `launchd` stays as an older spelling.
- `contract` in the manifest says which version the app follows.
- Clarified after the first onboardings (no change of meaning): `Idempotency-Key` is looked up before
  anything else; "already running" is a 409; an exhausted limit is a 409; `verify` also holds when the
  check is no longer reported; component ids are snake_case.
