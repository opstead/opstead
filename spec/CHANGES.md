# Contract changes

## 0.5 (2026-11-03)

- **What changed and when**: three optional sources tell an operator what runs, when it changed and
  where its code lives, so an investigation can start from the last deploy. None is a level.
  - `/ops/health` may carry `commit` (hex, at least 7) and `deployed_at` (ISO 8601) beside `version`,
    read from what the build or deploy stamped, left out when unknown.
  - The manifest may carry `source`: `{ "repo": "https://…", "path"?: "backend" }`, any host. A
    credential in the URL (`user:token@`, a token in the query) is an error for the checker.
  - The production pipeline posts **deploy events** (`started`, `succeeded`, `failed`; `version`,
    `commit`, `repo`, `run_url`, `at`) to the operator's deploy URL with the app's own deploy token,
    which can do nothing else. Staging, previews and pull-request builds post nothing; a run that
    fails at any step posts `failed`; the step never fails a deploy. Schema: `deploy.schema.json`.
  - Enrolment hands out the deploy token (`deploy_token`, `deploy_url`); `opstead connect` writes
    `OPS_DEPLOY_TOKEN` and `OPS_DEPLOY_URL`, and with `--ci github` sets them as Actions secrets.

  Additive: a 0.4 app is a valid 0.5 app.

## 0.4 (2026-11-03)

- **Tech**: a component may declare `tech`, what it runs on: `[{ "name": "MySQL", "version": "5.7.44" }]`,
  the product as people call it and the version as precisely as the running thing reports it (left
  out when unknown). An operator shows it on the map and warns before a product's end of support.
  Optional, raises no level; additive, so a 0.3 manifest is a valid 0.4 one.

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
