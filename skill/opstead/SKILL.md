---
name: opstead
description: Add the OPStead ops contract to an app so an operator can watch it, place problems in it, investigate it and run the fixes it declares safe, and register apps, machines and sites with the operator (its plugins for hosts, networks, edge providers, notice channels and login). Use when the user wants an app monitored by OPStead, asks for /ops/health, /ops/manifest, ops tools or ops actions, wants an app "onboarded", "made watchable" or "brought to level N", wants a server, machine or website brought under watch, or asks what `opstead check` reports and how to fix it.
---

# Onboard an app to the OPStead contract

The contract is in `spec/CONTRACT.md` of github.com/opstead/opstead (read it when a detail here is
not enough; this skill is the working summary). Code patterns per framework are in
`reference/patterns.md` next to this file; registering the app, a machine or a website with the
operator, and which plugin each field picks, is `reference/operator.md`. The checker is `npx opstead check <url> --token <token>`.

The app is the authority on itself: it says what is wrong, what it is made of, what is normal, what
may be looked at and what may be done. Your job is to write those down **from what the code really
does**, not to add generic monitoring.

## 0. Decide the target level with the user

| Level | Adds | Default |
|---|---|---|
| 1 health | `GET /ops/health` | always |
| 2 shape | `components` and `providers` (at least `hosting`) in `GET /ops/manifest` | always |
| 3 knowledge | `context`, read-only `tools` | always |
| 4 hands | `actions` that change things | only with the user's yes, action by action |

Go to level 3 without asking. Before level 4, list the actions you propose (name, what it changes,
risk, limit, preconditions, dry run, rollback, the check `verify` will name) and wait for the user to agree; an action is a standing permission for a
machine to change their system.

## 1. Survey before writing

Read enough of the app to answer, and keep the answers in your head for every later step:

- How it serves HTTP (framework, entry file, port, how routes are added, how it is tested).
- What it is made of: processes, scheduled jobs (cron, timers, queues, launchd/systemd units),
  stores (databases, buckets, files), other people's systems it calls (APIs, mail, payment, AI).
- What already goes wrong or is watched: existing health routes, logged errors, retries, timeouts,
  rate limits, "stale" data, queues that back up, comments that say "this happens sometimes".
- What is *normal* that looks like a fault: expected 403s, quiet weekends, a nightly window.
- Which work takes more than a few seconds (a search, a sync, an import), what one run of it is, how
  its size is counted, and which steps it goes through: look at the progress it shows users and its
  log lines. Which of those steps wait on someone else's system.
- What a person does by hand when something breaks (rerun a job, disable a bad record, clear a lock):
  those are the candidate actions.
- How it is configured (env file, secrets) and deployed, and which processes share that config (a
  server and a cron job often do not).
- Which companies it relies on to run and reach people (step 4, `providers`): where it is hosted, what
  sits in front of it (a CDN, a proxy, a tunnel), who sends its mail, where its files or backups live,
  who holds its DNS and its domain. Look in deploy scripts, Dockerfiles and compose files, CI
  workflows, IaC (Terraform, `fly.toml`, `vercel.json`, `netlify.toml`, `wrangler.toml`, `app.yaml`),
  SMTP or mail-API settings, storage SDKs and bucket names, and DNS or hosting notes in the docs.

What the repo does not tell you (the public URL, the service name it runs under, how it is deployed,
how often a job runs in production), do not invent: leave it out of the manifest and list it as a
question in your report.

Bugs you find on the way (a hole, a race) are not this task: report each one; turn it into a health
check only when it is a misconfiguration the app can detect (`config`), and fix it only if the user asks.

If the app has no HTTP server at all (a pure worker), add a small one on a side port bound to
localhost for `/ops/*` only, and say so.

## 2. The token and the routes

- Read `OPS_TOKEN` from the environment. If it is unset, the `/ops/*` routes answer 404 (the app
  still starts). Add `OPS_TOKEN=` to the example env file and never commit a value (check the example file is
  really tracked: `git check-ignore -v <file>`; a `.env.*` rule often hides it, and say so if it does). Tell the user to
  set it (`openssl rand -hex 24`) wherever the server process gets its environment; if the app loads
  no env file, say exactly that rather than adding a loader. When the owner's prompt carries an
  enrolment link from the operator, run `npx -y opstead connect <link> --env <the env file the server
  reads> [--app-url <where /ops/ answers, as the operator reaches it>]` instead: it writes the token
  (and the heartbeat settings) into that file without printing them, and registers the app with the
  operator, so no apps-file entry is needed. Do it first, before writing code: the link works once,
  within a day. When production takes its settings from CI secrets or a host panel, copy them there
  from that file without printing them (GitHub Actions: `grep '^OPS_TOKEN=' <file> | cut -d= -f2- |
  gh secret set OPS_TOKEN`). A used or old link: ask the owner for a new one from the operator's page.
- Check `Authorization: Bearer <token>` with a constant-time compare on every `/ops/*` route; answer
  404 without it. Any body is fine on a 404.
- Mount the routes under `/ops/` in the app's own style (a router, a plugin, a blueprint). Anything
  else under `/ops/` (an unknown path, a wrong method, `/ops/actions/*` before level 4) answers 404.
  Frameworks answer a wrong method with 405 by default (FastAPI, Starlette, some routers): add a
  catch-all `/ops/{path}` for every method, last.

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
- **State kept in memory** (counters since start, the last call's result) is empty after a restart:
  report `ok` "nothing to judge since start-up" until there is enough, rather than a false alarm.
- **A job inside the service** (a timer in the process, not cron): its heartbeat is still the
  operator's (step 4); the app may add a freshness check on what the job produces (`stale`), not on
  whether the timer fired.
- **Started on demand** (a headless browser, a worker pool, a model loaded when asked): absent while
  nothing needs it is the design, so `ok` with a detail that says so; `bad` only when work is waiting
  for it and it is not there.
- **Speed is not judged here.** For the long operations found in step 1, the app records and serves
  facts (step 5, `/ops/runs`); the operator decides what is slow. Write a check about duration only
  for a hard limit users feel (a request hitting the page's timeout), under its own id.
- A single failure may be a `warn` as a count ("1 search failed in the last hour"); the minimum
  count applies to grading a share as `bad`.

## 4. Level 2: `components` in `GET /ops/manifest`

Manifest: `{ app, contract: "0.4", version, components, providers, context, tools, actions, operations? }`.

One component per part found in step 1:

- `id`: snake_case (`owner_page`, not `owner-page` or `channel:x`); one built from config is
  normalised to snake_case the same way every time.
- `kind`: `service` (a process), `job` (scheduled work), `store`, `external` (someone else's system),
  `ui` (a site people use).
- `depends_on`: what it needs, by id (every id must exist).
- `checks`: which health checks are about it (`{ id }`, or `{ id, subject }` for one subject).
- `service`: the host service name (systemd unit, launchd label, container) when the operator should
  watch that it runs. `job`: the heartbeat name of a scheduled job. `url` + `probe: true` for the
  public site or anything nothing else checks.
- `description`: one line on what it does and what is normal for it.
- `tech` (optional): what the part runs on, `[{ "name": "MySQL", "version": "5.7.44" }]`. See below.

Every component should be watched by something (checks, service, job, probe), except a store that
its dependants' checks already cover. For each scheduled job, add the heartbeat call at the end of
the job (see `reference/patterns.md`); it must never fail the job. The path is
`<HEARTBEAT_URL>/<app>/<job>`, with `<app>` the same name as the health reply's `app` and `<job>` the
component's `job`. `success=false` means the run as a whole failed (it stopped, or did nothing it
should have); items that failed inside a run that worked belong in a health check, not the beat.

An `external`'s `url` is its public address only: never a URL from config that may hold a key or a
token. Until level 4, leave `actions` out of the manifest (or send `[]`).

### `tech`

The operator shows what each part runs and warns before its version loses support, so fill it for
the parts whose runtime the app can see: the database, the language runtime, the web server.

- `name`: the product as people call it (`MySQL`, `MariaDB`, `PostgreSQL`, `PHP`, `Node.js`,
  `Python`, `Redis`, `nginx`, `Apache`, `Ubuntu`). Tell MariaDB from MySQL by the running version
  string (`10.11.6-MariaDB`), not by the driver name.
- `version`: read it from the running thing, in the manifest handler, so it stays true after an
  upgrade: `SELECT VERSION()` (MySQL, MariaDB, PostgreSQL: `SHOW server_version` for the bare
  number), `INFO server` → `redis_version`, `PHP_VERSION`, `process.version` (drop the `v`),
  `platform.python_version()`, `$_SERVER['SERVER_SOFTWARE']` when it shows one. Cache a database's
  answer for the process's life; if the query fails, leave `version` out rather than fail the manifest.
- Only when the running value cannot be read (a web server that hides its version, an OS), take it
  from a lock file, `.nvmrc`, `engines`, or a Dockerfile's `FROM` tag, and keep only the precision it
  really gives (`FROM node:22-alpine` is `"22"`).
- **Never guess a version.** No source: write `{ "name": "Apache" }` without one. A part whose
  product is not known gets no `tech`.
- In the report, name where each value came from (`SELECT VERSION()` at runtime, `Dockerfile FROM`).

### `providers`

Level 2 also needs the companies the app runs on and reaches people through, at least the `hosting`
one. The operator draws each company once for every app that names it, watches its status page, and
tells its trouble above the parts it serves; when the app moves host, this is what changes the checks.

```json
"providers": [
  { "kind": "hosting", "name": "IONOS", "what": "shared hosting: Apache, PHP, MySQL" },
  { "kind": "mail", "name": "IONOS", "serves": ["contact"] },
  { "kind": "edge", "name": "Cloudflare" }
]
```

- `kind`: `hosting`, `edge` (CDN, proxy, tunnel), `dns`, `mail`, `storage`, `registrar`.
- `name`: the company as people call it; `"self"` for hosting on the operator's own machine (a launchd
  or systemd service there, a container on it).
- `what`: one line, optional. `serves`: the component ids that need it, optional; omit it when every
  part does (hosting usually), name them when only some do (mail for the contact form).
- `status_url`: optional, a Statuspage-shaped `…/api/v2/status.json` for a company an operator is
  unlikely to know (it knows the big ones).
- **Never guess a company.** Write one only when the code or the deploy config shows it (a
  `fly.toml` is Fly.io; an SMTP host `smtp.ionos.com` is IONOS mail; a `wrangler.toml` is Cloudflare;
  a launchd plist or systemd unit deployed to the operator's machine is `self`). A domain alone does not
  tell who hosts it. Whatever the repo does not show, ask the owner before writing it, one short
  question per gap ("Where does this run in production: which company, or one of your own machines?",
  "Who holds the DNS for example.com?"). If the owner does not know the hosting either, stop at level 1
  for this app and say why; leave out the other kinds rather than guess them.
- Leave out a kind the app does not use (no mail sent: no `mail`).
- Hardcode them in the manifest like the components: they change with the deploy, not per request.

## 5. Level 3: `context` and `tools`

`context`: a paragraph for an AI investigator: what the app does and for whom, its rhythm (what runs
when), what is normal that looks wrong, known fragile spots, where its data comes from. Write it from
step 1; it is the most useful thing you produce.

`tools`: read-only questions an investigator would ask about the checks you wrote. Usually one or
two per non-`ok`-able check: "which items are stale and why", "the last N errors for provider X",
"the state of one record". Each:

- `{ name, description, params?, network? }`; served as `GET /ops/tools/<name>?param=…`.
- Strictly read-only. Validate params (400), hard row limit (50), small JSON reply.
- No secrets, tokens, or personal data the investigator does not need. Error texts from providers
  often echo part of a key: blank anything key-shaped (`sk-…`, long hex or base64, `Bearer …`)
  before it leaves. "Row limit 50" means 50 lines for a log tail.
- `network: true` if it calls someone else's server.

### Long work: `operations` and `GET /ops/runs`

For each operation that takes more than a few seconds (step 1):

- Record every run and its steps in the app's own store (a table or a JSONL file; see
  `reference/patterns.md`): operation, size in units, start, seconds, ok; per step: name, units,
  seconds, ok. Mark steps where the progress shown to users already changes. Waiting on an outside
  system is its own step. Keep 7 days or 100 runs. **Durations and counts only**, never what a user
  asked for (routes, dates, queries).
- Serve them at `GET /ops/runs?operation=&since=&limit=`, newest first, at most 100, shaped as in the
  contract (`{ "runs": [ { operation, id, at, units, s, ok, steps: [ { name, units, s, ok } ] } ] }`).
- Declare them in the manifest: `operations: [{ name, description, unit, steps: [{ name, unit }] }]`,
  and say in `context` what durations are normal and when slower is expected.
- Do not compute "slow" in the app: the operator compares each operation and step per unit with its
  own baseline, and its AI reads the runs.
- Split an operation when its kinds have different fixed costs (a one-way and a round-trip search):
  time per unit only compares runs whose fixed part is alike.
- A step may carry extra counts of known causes (`"empty": 3` stays with no prices): they explain a
  slow step better than splitting it further.
- A cancelled run is recorded with `ok: false, cancelled: true` (the operator leaves it out of speed),
  or not at all. Bad params on `/ops/runs` answer 400. Keep 7 days or the last 100 runs **per operation**.
- A wait that decides "there is no data" (a page that stays blank) must be longer than the source's
  normal loading time: measure it on real runs before choosing it, or empty results turn into false ones.

## 6. Level 4: `actions` (only after the user agreed)

Each action: `{ name, title, description, params?, risk, limit, rollback?, dry_run?, schedule?, checks? }`, served as
`POST /ops/actions/<name>` with a JSON body of params plus `reason` and `dry_run`.

- `risk`: `low` = small and undoable, safe unasked; `medium` = users would notice or data that matters
  changes, the owner approves; `high` = hard to undo, never run by default. When unsure, go higher.
- `limit`: `"<n>/<duration>"` that bounds the damage of a loop (`"1/45m"`, `"20/1d"`).
- `title`: a few plain words the owner understands at a glance ("Move the site to its new board"),
  at most 60 characters. `description` is for the AI: what it changes, its preconditions, when to use it.
- `checks`: the health check ids it helps with. The owner can take a problem in hand and run actions
  themselves; these come first there, and a param named like a field of the check's `data` (or the
  only param, from its `subject`) is filled in for them. So name params after those fields.
- The handler does these **in this order**:
  1. **`Idempotency-Key` first.** A key seen in the last 24 h returns the stored status and body, with
     no other work (a retry after a run that changed things must get the first answer, not a 409).
     A key whose first request is still running answers `409 {"error": "already running"}`.
  2. **Params** (400).
  3. **Limit**, if the app enforces it (409 with "limit of 3 a day reached").
  4. **Preconditions, re-checked now** (409 `{"error": "<why>"}`), changing nothing.
  5. **Dry run**: `{"dry_run": true, "would": "<what it would do>"}`, changing nothing.
  6. **Run, log, answer** `{"result": "<what was done>", "verify": {check, subject?, after}}`.
- Store under the key the answer of every run that changed or may have changed something, including
  one that failed with a 500, and count those runs against the limit. Do not store 400, 409 or dry runs.
- Keys kept in memory die with the process. Keep them in the app's database or a file; an action that
  can end the app's own process (a restart, an upgrade) MUST store its answer **before** it acts.
- An action whose effect shows only later, or after the reply (a restart, a job started in the
  background), answers what it did ("restart scheduled") and names a `verify`; the operator looks
  again after `after`. An effect that visibly did not take answers 200 with a `result` that says so.
- `verify` holds when the named check is `ok` **or no longer reported** (an action that removes the
  thing the check was about).
- The operator enforces `limit`; the app SHOULD enforce it too by counting its own action log (see
  `reference/patterns.md`), which also guards against anything else holding the token.
- In the app's log, "who" is the source (`ops`) plus the `reason` the operator sent; there is one token.
- Ignore body fields you do not know (the operator adds `reason` and `dry_run`; later versions may add
  more). Reject only declared params that are missing or of the wrong type.
- Never an action that runs free text (shell, SQL, a URL to fetch). Params are values for one fixed
  operation. Prefer `dry_run: true` for every medium action, and a `rollback` action when one exists.

## 7. Tests

Add tests in the app's own framework for: the token (404 without it), each health check at ok and
at its failing level, the manifest's ids and cross-references, each tool's param validation and
read-only-ness, and for each action: 400, 409 on a failed precondition, dry run changes nothing,
idempotency, the real run. Run the app's whole test suite.

## 8. Verify with the checker

The checker only reads: it never calls tools or actions. Their 400, 409, dry run and idempotency are
covered by the tests of step 7, so those tests are not optional.


Start the app locally with `OPS_TOKEN` set and **the settings production uses** (the components and
checks often depend on them; read the production env's keys, never print their values), and run (use `127.0.0.1`, not `localhost`, which may
resolve to `::1` while the app listens on IPv4 only):

```bash
npx -y opstead check http://127.0.0.1:<port> --token "$OPS_TOKEN"
```

Fix every `error`. Fix each `warn` or say in your report why it stays. Repeat until it reports the
target level. `--json` gives the same report for parsing. Stop the app afterwards by its PID.

## 9. Register with the operator

If you can reach the operator's apps file (the user says where), add the entry as
`reference/operator.md` shows; otherwise put the entry in your report. A machine or website with no
app of its own (a server, a hosted site) needs only that step: skip 0-8.

## 10. Report to the user

- The level reached and the checker's remaining warnings.
- The checks, components, tools and actions added, one line each.
- What the operator needs: the app's base URL, that `OPS_TOKEN` must be in the server's environment
  (never its value), the services to watch, each job with how often it runs.
- The providers declared, and where each came from (a file, or the owner's answer).
- The `tech` of each part, and where each value came from (read at runtime, a lock file, an image
  tag); which versions could not be known.
- Anything you guessed (a threshold, what is normal) and anything the repo did not tell you (URL,
  service name, deploy), as questions for the user.
- Bugs found on the way, each in one line.
