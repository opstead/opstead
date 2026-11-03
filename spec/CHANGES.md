# Contract changes

## 0.3 (2026-11-03)

- **Providers**: the manifest declares `providers`, the companies the app relies on to run and to
  reach people (`kind`: `hosting`, `edge`, `dns`, `mail`, `storage`, `registrar`; `name`; optional
  `what`, `serves`, `status_url`). An operator draws each company once, shared by every app that names
  it, watches its status page, and tells its trouble above the parts it serves in one notice; moving
  host changes what is checked. **Level 2 now needs a `hosting` provider** besides `components`, so
  an app that was level 2 or above under 0.2 is level 1 until it declares one (`"name": "self"` for
  the operator's own machine).

## 0.2, additions (2026-11-01)

- Actions get `title` (SHOULD): a few plain words for the owner, since `description` is written for
  the AI and grows long. And `checks` (MAY): the health checks an action helps with, so an operator
  offers it first when the owner takes such a problem in hand and runs actions themselves. Additive.

## 0.2 (2026-11-01)

- **Speed**: apps with long work record each run and its steps (size in units, durations) and serve
  them at `GET /ops/runs`; they declare `operations` in the manifest. The operator judges slowness
  (`slow`, per unit, against each operation's and step's own baseline) and its AI reads the runs.
  Added after a search that took 5 minutes because one step waited 25 s for each stay with no prices,
  while the outside services answered in milliseconds. Additive: a 0.1 app is a valid 0.2 app.
  (A first draft of 0.2, on the repo for a few hours and never released, had apps judge `slow`
  themselves and offer a `timings` tool; apps built on it should drop both.)

## 0.1 (2026-11-01)

First published version, written down from what a private operator and its apps already did:
`/ops/health`, `/ops/manifest` (components, context, tools, actions), `/ops/tools/<name>`,
`/ops/actions/<name>` with `dry_run`, `Idempotency-Key`, 409 and `verify`, `/ops/metrics`, heartbeats.

- `service` on a component names the host service that runs it; `launchd` stays as an older spelling.
- `contract` in the manifest says which version the app follows.
- Clarified after the first onboardings (no change of meaning): `Idempotency-Key` is looked up before
  anything else; "already running" is a 409; an exhausted limit is a 409; `verify` also holds when the
  check is no longer reported; component ids are snake_case.
