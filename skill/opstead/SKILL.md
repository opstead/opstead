---
name: opstead
description: Add the OPStead ops contract to an app so an operator can watch it, place problems in it, investigate it and run the fixes it declares safe. Use when the user wants an app monitored by OPStead, asks for /ops/health, /ops/manifest, ops tools or ops actions, wants an app "onboarded", "made watchable" or "brought to level N", or asks what `opstead check` reports and how to fix it.
---

# Onboard an app to the OPStead contract

The contract is in `spec/CONTRACT.md` of github.com/opstead/opstead (read it when a detail here is
not enough; this skill is the working summary). Code patterns per framework are in
`reference/patterns.md` next to this file. The checker is `npx opstead check <url> --token <token>`.

The app is the authority on itself: it says what is wrong, what it is made of, what is normal, what
may be looked at and what may be done. Your job is to write those down **from what the code really
does**, not to add generic monitoring.

## 0. Decide the target level with the user

| Level | Adds | Default |
|---|---|---|
| 1 health | `GET /ops/health` | always |
| 2 shape | `components` in `GET /ops/manifest` | always |
| 3 knowledge | `context`, read-only `tools` | always |
| 4 hands | `actions` that change things | only with the user's yes, action by action |

Go to level 3 without asking. Before level 4, list the actions you propose (name, what it changes,
risk, limit, preconditions) and wait for the user to agree; an action is a standing permission for a
machine to change their system.

## 1. Survey before writing

Read enough of the app to answer, and keep the answers in your head for every later step:

- How it serves HTTP (framework, entry file, port, how routes are added, how it is tested).
- What it is made of: processes, scheduled jobs (cron, timers, queues, launchd/systemd units),
  stores (databases, buckets, files), other people's systems it calls (APIs, mail, payment, AI).
- What already goes wrong or is watched: existing health routes, logged errors, retries, timeouts,
  rate limits, "stale" data, queues that back up, comments that say "this happens sometimes".
- What is *normal* that looks like a fault: expected 403s, quiet weekends, a nightly window.
- What a person does by hand when something breaks (rerun a job, disable a bad record, clear a lock):
  those are the candidate actions.
- How it is configured (env file, secrets) and deployed, and which processes share that config (a
  server and a cron job often do not).

What the repo does not tell you (the public URL, the service name it runs under, how it is deployed,
how often a job runs in production), do not invent: leave it out of the manifest and list it as a
question in your report.

Bugs you find on the way (a hole, a race) are not this task: report each one; turn it into a health
check only when it is a misconfiguration the app can detect (`config`), and fix it only if the user asks.

If the app has no HTTP server at all (a pure worker), add a small one on a side port bound to
localhost for `/ops/*` only, and say so.

## 2. The token and the routes

- Read `OPS_TOKEN` from the environment. If it is unset, the `/ops/*` routes answer 404 (the app
  still starts). Add `OPS_TOKEN=` to the example env file and never commit a value. Tell the user to
  set it (`openssl rand -hex 24`) wherever the server process gets its environment; if the app loads
  no env file, say exactly that rather than adding a loader.
- Check `Authorization: Bearer <token>` with a constant-time compare on every `/ops/*` route; answer
  404 without it.
- Mount the routes under `/ops/` in the app's own style (a router, a plugin, a blueprint). Anything
  else under `/ops/` (an unknown path, a wrong method, `/ops/actions/*` before level 4) answers 404.

## 3. Level 1: `GET /ops/health`

Reply: `{ app, version, at, status, checks: [{ id, level, subject?, detail, data? }] }`.

Write checks for the things in step 1 that can be wrong **and that the app can judge itself**:

- A store answers (`db`: a `SELECT 1` with a short timeout).
- Work is fresh (`stale`: the newest row of the thing a job produces is younger than twice its period).
- Queues and backlogs are bounded (`backlog`: pending items, oldest age).
- External systems answer as the app last saw them (`errors` with `subject` per provider: the share of
  failed calls in the last hour from the app's own records; never call the provider from `/ops/health`).
- Quotas and budgets (`quota`: used/limit for an API key or a plan).
- Config that must be present (`config`: a required key missing).

Rules (the ledger depends on them):

- `id` is a short snake_case kind, fixed in code. A variable part goes in `subject`. `id`+`subject` is
  the problem's identity: unique per reply, stable across requests.
- `level`: `ok`, `warn` (attention soon), `bad` (broken now). Pick thresholds from the code and the
  data, and write them as named constants with a comment saying why.
- `detail`: one English sentence with the numbers ("713 of 1370 products not updated in 24 h").
  `data`: the numbers.
- Report `ok` checks too. `status` is the worst level.
- Do not report liveness, process state, job heartbeats or site speed: the operator sees those from
  outside (`http_down`, `service_down`, `heartbeat_missed`, `job_failed`, `http_slow`).
- Must be read-only and fast (under 2 s): bounded queries, timeouts, cache an expensive part for 60 s.
- One check failing to compute is itself a `bad` check with the error in `detail`, not a 500.
- **Nothing to judge** (no run in the window, no rows yet): report `ok` and say so in `detail`
  ("no sync run in the last 2 h to judge"); another check (`stale`, a missed heartbeat) catches the absence.
- **Small numbers**: do not grade a share below a minimum count (a named constant, e.g. 5 items); 1
  failure in 2 is not 50 % of anything.
- **Normal that looks wrong** (a supplier's nightly rebuild, a quiet weekend): leave it out of the
  check with a named constant and a comment that says why, and say it in `context`.
- **Per store**: Postgres/MySQL `SELECT 1` with a statement timeout; SQLite also a `busy_timeout`, since
  its real failure is a writer's lock; a bucket or a directory: list or stat one known key.
- Write checks that depend on the time with an injectable "now" so tests can set it.

## 4. Level 2: `components` in `GET /ops/manifest`

Manifest: `{ app, contract: "0.1", version, components, context, tools, actions }`.

One component per part found in step 1:

- `kind`: `service` (a process), `job` (scheduled work), `store`, `external` (someone else's system),
  `ui` (a site people use).
- `depends_on`: what it needs, by id (every id must exist).
- `checks`: which health checks are about it (`{ id }`, or `{ id, subject }` for one subject).
- `service`: the host service name (systemd unit, launchd label, container) when the operator should
  watch that it runs. `job`: the heartbeat name of a scheduled job. `url` + `probe: true` for the
  public site or anything nothing else checks.
- `description`: one line on what it does and what is normal for it.

Every component should be watched by something (checks, service, job, probe), except a store that
its dependants' checks already cover. For each scheduled job, add the heartbeat call at the end of
the job (see `reference/patterns.md`); it must never fail the job. The path is
`<HEARTBEAT_URL>/<app>/<job>`, with `<app>` the same name as the health reply's `app` and `<job>` the
component's `job`. `success=false` means the run as a whole failed (it stopped, or did nothing it
should have); items that failed inside a run that worked belong in a health check, not the beat.

An `external`'s `url` is its public address only: never a URL from config that may hold a key or a
token. Until level 4, leave `actions` out of the manifest (or send `[]`).

## 5. Level 3: `context` and `tools`

`context`: a paragraph for an AI investigator: what the app does and for whom, its rhythm (what runs
when), what is normal that looks wrong, known fragile spots, where its data comes from. Write it from
step 1; it is the most useful thing you produce.

`tools`: read-only questions an investigator would ask about the checks you wrote. Usually one or
two per non-`ok`-able check: "which items are stale and why", "the last N errors for provider X",
"the state of one record". Each:

- `{ name, description, params?, network? }`; served as `GET /ops/tools/<name>?param=…`.
- Strictly read-only. Validate params (400), hard row limit (50), small JSON reply.
- No secrets, tokens, or personal data the investigator does not need.
- `network: true` if it calls someone else's server.

## 6. Level 4: `actions` (only after the user agreed)

Each action: `{ name, description, params?, risk, limit, rollback?, dry_run?, schedule? }`, served as
`POST /ops/actions/<name>` with a JSON body of params plus `reason` and `dry_run`.

- `risk`: `low` = small and undoable, safe unasked; `medium` = users would notice or data that matters
  changes, the owner approves; `high` = hard to undo, never run by default. When unsure, go higher.
- `limit`: `"<n>/<duration>"` that bounds the damage of a loop (`"1/45m"`, `"20/1d"`).
- The handler must, in order: check params (400); **re-check its preconditions now** and answer
  `409 {"error": "<why>"}` without changing anything if they do not hold; on `dry_run: true` answer
  `{"dry_run": true, "would": "<what it would do>"}` and change nothing; honour `Idempotency-Key`
  (same key → same answer, no second run, keep keys 24 h); then act, log (who, params, reason,
  result) and answer `{"result": "<what was done>", "verify": {check, subject?, after}}` when a health
  check should turn `ok` afterwards.
- Never an action that runs free text (shell, SQL, a URL to fetch). Params are values for one fixed
  operation. Prefer `dry_run: true` for every medium action, and a `rollback` action when one exists.

## 7. Tests

Add tests in the app's own framework for: the token (404 without it), each health check at ok and
at its failing level, the manifest's ids and cross-references, each tool's param validation and
read-only-ness, and for each action: 400, 409 on a failed precondition, dry run changes nothing,
idempotency, the real run. Run the app's whole test suite.

## 8. Verify with the checker

Start the app locally with `OPS_TOKEN` set and run (use `127.0.0.1`, not `localhost`, which may
resolve to `::1` while the app listens on IPv4 only):

```bash
npx -y opstead check http://127.0.0.1:<port> --token "$OPS_TOKEN"
```

Fix every `error`. Fix each `warn` or say in your report why it stays. Repeat until it reports the
target level. `--json` gives the same report for parsing. Stop the app afterwards by its PID.

## 9. Report to the user

- The level reached and the checker's remaining warnings.
- The checks, components, tools and actions added, one line each.
- What the operator needs: the app's base URL, that `OPS_TOKEN` must be in the server's environment
  (never its value), the services to watch, each job with how often it runs.
- Anything you guessed (a threshold, what is normal) and anything the repo did not tell you (URL,
  service name, deploy), as questions for the user.
- Bugs found on the way, each in one line.
