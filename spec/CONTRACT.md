# The OPStead contract, version 0.4

What an app serves about itself so that an operator (OPStead, or anything else that reads this) can
watch it, place a problem in it, investigate it and, within limits the app sets, fix it.

The app is the authority on itself. It says what is wrong, what it is made of, what is normal, what
may be looked at and what may be done. The operator decides when to look, whom to tell and whether a
proposed fix may run; the app re-checks its own preconditions before it does anything.

The key words MUST, SHOULD and MAY are used as in RFC 2119. JSON Schemas for every reply are in
[`schema/`](schema); examples in [`examples/`](examples).

## Levels

An app adopts the contract one level at a time. Each level is useful on its own, and a level counts
only when every level below it holds. `opstead check <url>` reports the level an app reaches.

| Level | The app serves | The operator can then |
|---|---|---|
| 1 health | `GET /ops/health` | open one problem per thing that is wrong and tell the owner once per change |
| 2 shape | `components` and a `hosting` provider in `GET /ops/manifest` | draw the app and say which part is failing, and when the trouble is its host's or another company's |
| 3 knowledge | `context` and `tools` in the manifest, `GET /ops/tools/<name>`; `operations` and `GET /ops/runs` for long work | let an AI investigate with the app's own data, knowing what is normal; tell when work got slower and which step |
| 4 hands | `actions` in the manifest, `POST /ops/actions/<name>` | propose fixes; run the ones the policy allows; verify they worked |

`GET /ops/metrics` is optional at every level.

## Routes and the token

- All routes live under `/ops/` on the app's own HTTP server (the API, or a small side port).
- Every route MUST require `Authorization: Bearer <token>`. The token is one per app, set in the app's
  environment as `OPS_TOKEN`, and given to the operator. Compare it in constant time.
- Without the right token a route MUST NOT answer with data. It SHOULD answer `404` (so the routes do
  not advertise themselves); `401` is allowed.
- Replies are JSON (`application/json; charset=utf-8`) except `/ops/metrics`.
- Any other request under `/ops/` (an unknown path, a wrong method, an action route the app does not
  declare) answers `404`.
- `/ops/health` and `/ops/manifest` SHOULD answer within 2 seconds and MUST NOT change anything.
- All text meant for people (`detail`, `description`, `context`, `result`, errors) is written in
  English, one plain sentence where possible. The operator translates for its owner.

## Level 1: `GET /ops/health`

The app's own judgement of itself, made fresh on each request (cache expensive parts for a minute if
needed).

```json
{
  "app": "shop",
  "version": "3c49e78",
  "at": "2026-11-01T12:00:00Z",
  "status": "warn",
  "checks": [
    { "id": "db", "level": "ok", "detail": "Postgres answered in 3 ms" },
    { "id": "stale", "level": "warn", "subject": "supplier-a", "detail": "713 of 1370 products not updated in 24 h", "data": { "stale": 713, "total": 1370 } }
  ]
}
```

| Field | | |
|---|---|---|
| `app` | SHOULD | The app's name, stable, lowercase. |
| `version` | SHOULD | A commit or release, so a problem can be tied to a deploy. |
| `at` | MAY | When this judgement was made (ISO 8601). |
| `status` | SHOULD | `ok`, `warn` or `bad`: the worst level among the checks. |
| `checks` | MUST | An array, one entry per thing the app looks at. |

Each check:

| Field | | |
|---|---|---|
| `id` | MUST | The kind of check: `snake_case`, few, stable, defined in code. Never put a variable part in it. |
| `level` | MUST | `ok` (fine), `warn` (needs attention soon), `bad` (broken now). |
| `subject` | MAY | The thing it is about (`supplier-a`, `queue:emails`). |
| `detail` | SHOULD (MUST unless `ok`) | One English sentence saying what is found, with the numbers. |
| `data` | MAY | An object of numbers and short values behind the sentence. |

Rules that make the ledger work:

- **Identity.** `id` + `subject` is a problem's identity: the operator opens one problem per pair that
  is not `ok`, and closes it when the pair is `ok` or gone. The pair MUST be unique in one reply.
  A changing `detail` (numbers moving) is the same problem; a changing `subject` is a different one.
- **Report `ok` too.** A check that is fine SHOULD still be listed with `level: "ok"`, so the owner sees
  what is watched and a misspelt id is caught.
- **Judge, don't dump.** The app decides what is wrong. `warn` and `bad` mean a person or an AI should
  look; numbers that are merely interesting belong in `data` or `/ops/metrics`.
- **Not the operator's checks.** The app does not report whether it is up, whether its process runs,
  whether its jobs beat or how fast its site answers: the operator sees those from outside
  (`http_down`, `http_slow`, `service_down`, `heartbeat_missed`, `job_failed`). If `/ops/health`
  cannot answer at all, that is itself the signal.

## Level 2: `GET /ops/manifest` with `components` and `providers`

The manifest is the app's description of itself for the operator and its AI. It changes when the
code changes, not from request to request.

```json
{
  "app": "shop",
  "contract": "0.1",
  "version": "3c49e78",
  "components": [
    { "id": "api", "name": "API", "kind": "service", "service": "shop-api", "depends_on": ["db", "payments"], "checks": [{ "id": "db" }] },
    { "id": "db", "name": "Postgres", "kind": "store" },
    { "id": "sync", "name": "price sync (hourly)", "kind": "job", "job": "sync", "depends_on": ["db", "supplier_a"], "checks": [{ "id": "stale" }] },
    { "id": "supplier_a", "name": "Supplier A", "kind": "external", "url": "https://supplier-a.example", "checks": [{ "id": "stale", "subject": "supplier-a" }] },
    { "id": "payments", "name": "Payments", "kind": "external", "group": "Providers" },
    { "id": "site", "name": "the shop", "kind": "ui", "url": "https://shop.example", "probe": true, "depends_on": ["api"] }
  ],
  "providers": [
    { "kind": "hosting", "name": "Hetzner", "what": "one VPS: the API, the sync and Postgres" },
    { "kind": "edge", "name": "Cloudflare", "serves": ["site", "api"] }
  ]
}
```

Manifest fields at this level: `app` (SHOULD), `contract` (SHOULD: the version of this document the
app follows, `"0.4"`), `version` (MAY), `components` (MUST for level 2), `providers` (MUST for level 2,
with at least one `hosting` entry).

Each component:

| Field | | |
|---|---|---|
| `id` | MUST | Unique within the app, `snake_case` (`owner_page`, not `owner-page`). |
| `kind` | MUST | `service` (a process of the app), `job` (scheduled work), `store` (a database, a bucket, files), `external` (someone else's system), `ui` (a site or page people use). |
| `name` | SHOULD | How people call it. |
| `depends_on` | MAY | Ids of components this one needs. Each MUST be an id in the same manifest. Drawn as arrows; a failing dependency explains a failing dependant. |
| `checks` | MAY | Which `/ops/health` checks are about this component: `[{ "id": "stale", "subject": "supplier-a" }]`. Omit `subject` to match every subject of that id. The component's state is the worst of its open problems. |
| `description` | MAY | One line for the AI: what this part does, what is normal for it. |
| `url` | MAY | Where it lives (a site, an external's API). |
| `probe` | MAY | With `url`: the operator opens the URL every cycle and attaches `http_down` and `http_slow` here. Use it for the parts nothing else checks: the public site, a status page. |
| `service` | MAY | The name of the host service that runs it (a systemd unit, a launchd label, a container). The operator attaches `service_down`. `launchd` is accepted as an older spelling. |
| `job` | MAY | The heartbeat name of a scheduled job (see Heartbeats). The operator attaches `heartbeat_missed` and `job_failed`. |
| `app` | MAY | On an `external`: the name of another app the same operator watches. The arrow goes to that app instead of a second box. |
| `group` | MAY | Externals with the same group are drawn as one block until opened ("Job boards"). |
| `tech` | MAY | What the part runs on: `[{ "name": "MySQL", "version": "5.7.44" }]`. See below. |

A component with no `checks`, `service`, `job`, `probe` or `app` shows as *not watched*; that is
allowed (a `store` often is) but is worth a look.

#### `tech`

What a part runs on: its database, runtime, web server, OS. The operator shows it on the map and
warns before a product reaches its end of support (and after), so an old MySQL is a notice months
ahead rather than a surprise when the host turns it off.

```json
{ "id": "db", "name": "Database", "kind": "store", "tech": [{ "name": "MySQL", "version": "5.7.44" }] },
{ "id": "api", "kind": "service", "tech": [{ "name": "PHP", "version": "8.4.1" }, { "name": "Apache", "version": "2.4" }] }
```

| Field | | |
|---|---|---|
| `name` | MUST | The product as people call it: `MySQL`, `MariaDB`, `PostgreSQL`, `PHP`, `Node.js`, `Python`, `Redis`, `nginx`, `Apache`, `Ubuntu`. |
| `version` | MAY | As precise as known, read from the running thing where it can be (`SELECT VERSION()`, `PHP_VERSION`, `process.version`); from a lock file or a base image only when the running value cannot be read. Left out when unknown, never guessed. |

`tech` is optional and raises no level. A malformed entry is a warning, not an error.

### `providers`

The companies the app relies on to run and to reach people: its host, what carries its traffic, its
DNS, its mail. They are dependencies like any other, and the most shared: when a host or an edge is in
trouble, every part it serves fails with it, in every app it serves. Declared, the operator draws each
company once, shared by everything that names it, watches the company's own status page, and tells a
company's trouble above the parts it serves, in one notice, rather than as many unrelated failures. And
moving the app to another host changes what is worth checking; the declaration is what tells the
operator it moved.

```json
"providers": [
  { "kind": "hosting", "name": "IONOS", "what": "shared hosting: Apache, PHP, MySQL" },
  { "kind": "mail", "name": "IONOS", "serves": ["contact"] },
  { "kind": "edge", "name": "Cloudflare" }
]
```

| Field | | |
|---|---|---|
| `kind` | MUST | `hosting` (where it runs), `edge` (a CDN, proxy or tunnel in front of it), `dns`, `mail`, `storage` (files or backups at someone else's), `registrar`. |
| `name` | MUST | The company, as people call it (`"IONOS"`, `"Cloudflare"`). `"self"` for hosting on the operator's own machine; that machine then says the rest. |
| `what` | MAY | One line: what it provides (`"shared hosting: Apache, PHP, MySQL"`). |
| `serves` | MAY | Ids of the components that need it. Each MUST be a component id. Omitted: every part of the app. |
| `status_url` | MAY | The company's status page in the Statuspage shape (`…/api/v2/status.json`), for a company the operator does not already know. |

Level 2 needs at least one `hosting` provider. Declare only what is known: a company read from the
deploy setup or told by the owner, never guessed. A kind the app does not use (no mail sent) is left out.

## Level 3: knowledge

### `context`

A paragraph in the manifest: what the app does, who uses it, what is normal and what is not a fault.
This is what keeps an AI from "fixing" the expected.

```json
"context": "Sells garden tools in Canada. Every hour the price sync pulls from three suppliers; Supplier A answers 403 for a few minutes after midnight UTC while it rebuilds, which is normal. Orders are low on weekends."
```

It MUST be a string and SHOULD be at least a few sentences.

### `tools` and `GET /ops/tools/<name>`

Read-only questions the AI may ask the app while it investigates.

```json
"tools": [
  { "name": "stale_products", "description": "Products not updated in 24 h, oldest first, with their supplier and last error", "params": { "supplier": { "type": "string", "description": "only this supplier" }, "limit": { "type": "integer" } } },
  { "name": "supplier_status", "description": "Asks Supplier A's API whether a product exists", "params": { "sku": { "type": "string", "required": true } }, "network": true }
]
```

| Field | | |
|---|---|---|
| `name` | MUST | `snake_case`, unique; it is the path. |
| `description` | MUST | What it returns. The AI chooses tools by this sentence. |
| `params` | MAY | `{ "<name>": { "type": "string" \| "integer" \| "number" \| "boolean" \| "uuid", "required"?: true, "description"?: "…" } }` (`int` is read as `integer`). Values arrive as query strings; the tool converts them. |
| `network` | MAY | `true` when calling it makes a request to someone else's server; the operator spaces such calls out. |

The call is `GET /ops/tools/<name>?<param>=<value>&…` with the token. A tool:

- MUST NOT change anything, anywhere.
- MUST validate its params and answer `400 {"error": "…"}` when they are wrong, `404` for an unknown tool.
- SHOULD answer JSON, small (a few kB; the AI reads all of it), with a hard row limit.
- MUST NOT return secrets or personal data the AI does not need. Treat the reply as something that
  will be read by a model and may be shown to the owner.

## Level 4: hands

### `actions`

Changes the app is willing to make on request, each declared with how dangerous it is and how often
it may happen.

```json
"actions": [
  { "name": "retry_sync", "title": "Sync this supplier now", "checks": ["stale"], "description": "Runs the price sync for one supplier now", "params": { "supplier": { "type": "string", "required": true } }, "risk": "low", "limit": "1/45m", "rollback": null, "dry_run": true },
  { "name": "hide_product", "description": "Hides a product whose supplier page is gone", "params": { "product_id": { "type": "uuid", "required": true } }, "risk": "medium", "limit": "30/1d", "rollback": "show_product", "dry_run": true },
  { "name": "show_product", "description": "Shows a hidden product again", "params": { "product_id": { "type": "uuid", "required": true } }, "risk": "low", "limit": "30/1d" },
  { "name": "sweep_stale", "description": "Retries every product stale for more than a day, at most `limit` of them", "params": { "limit": { "type": "integer" } }, "risk": "low", "limit": "2/1d", "dry_run": true, "schedule": "1d" }
]
```

| Field | | |
|---|---|---|
| `name` | MUST | `snake_case`, unique; it is the path. |
| `description` | MUST | What it changes, in one sentence. |
| `risk` | MUST | `low`: undoable, small, safe to run without asking. `medium`: changes what users see or data that matters; the operator asks the owner first. `high`: hard to undo or wide; an operator never runs it by default. |
| `limit` | SHOULD | How often at most: `"<count>/<duration>"`, e.g. `"20/1d"`, `"1/45m"`. Durations use `ms`, `s`, `m`, `h`, `d`. The operator enforces it; the app MAY enforce it too. |
| `params` | MAY | As for tools. |
| `rollback` | MAY | The name of another action that undoes this one, or `null` when there is none. |
| `dry_run` | MAY | `true` when the action accepts `"dry_run": true` and then only says what it would do. SHOULD be `true` for `medium`: the owner approves what they can see. |
| `schedule` | MAY | A duration (`"1d"`): the operator may run it on its own that often, still through its policy. For housekeeping. |
| `title` | SHOULD | A few plain words for the owner (`"Sync this supplier now"`, at most 60 characters). The operator shows it on its page and in approvals; `description` is for the AI and may be long. |
| `checks` | MAY | The health check ids it can help with (`["stale"]`). When the owner takes such a problem in hand, the operator offers this action first. |

The owner can run actions too, not only the AI: an operator offers them on a problem the owner has
taken in hand, previews each one (`dry_run`) and runs what the preview showed. The app does nothing
different for them; the `reason` says who asked.

### `POST /ops/actions/<name>`

Request, with the token:

```
POST /ops/actions/hide_product
Authorization: Bearer …
Content-Type: application/json
Idempotency-Key: 6f1c…

{ "product_id": "3b0c…", "reason": "Supplier page answers 404 for 3 days", "dry_run": false }
```

The body is the params as a JSON object, plus `reason` (why the operator runs it, for the app's own
log) and, when declared, `dry_run`.

The app MUST, in this order:

1. **Check the token** (`404` without it) and that the action exists (`404`).
2. **Honour `Idempotency-Key`** first: the same key again (within at least 24 h) returns the first
   answer without running a second time, even when the first run changed what step 4 would now
   refuse. A key whose first request is still running answers `409 {"error": "already running"}`.
   An action that can end the app's own process stores its answer before it acts.
3. **Check the params** (`400 {"error": "…"}` when wrong).
4. **Re-check its preconditions**, in its own terms, at the moment of the call. The operator's view may
   be minutes old. When they do not hold, answer `409 {"error": "<why, one sentence>"}` and change nothing.
   *Example: "its last 2 polls did not both fail".*
5. **Honour `dry_run`**: when `true`, change nothing and answer `200 {"dry_run": true, "would": "<what it would do>"}`.
6. **Do it, log it, answer** `200 {"result": "<what was done>"}`, with `verify` when the effect can be checked.

```json
{ "result": "hidden", "verify": { "check": "stale", "subject": "supplier-a", "after": "40m" } }
```

`verify` names the `/ops/health` check (and subject) that should be `ok`, or no longer reported, after `after`. The operator
looks again then and tells the owner whether the fix held. Without `verify` the operator only records
the result.

Any other status is a failure; put the reason in `{"error": "…"}`. An app that enforces `limit` itself
answers `409` when it is used up.

The app SHOULD keep its own log of actions run through the contract (who, when, params, reason,
result), independent of the operator's.

## Speed: `GET /ops/runs`

From outside, the operator times only whole requests (`http_slow`). Whether a long piece of work got
slower, and which part of it, needs facts only the app has: what one run is, how big it was, which
steps it went through. The app **reports** those facts; the **operator judges** them (the same rule for
every app, its thresholds in one place) and gives them to its AI. A run's total misleads, because runs
differ in size and one slow step hides among fast ones.

An app that does work taking more than a few seconds (a search, a sync, an import, a report) SHOULD:

1. **Record each run**: the operation, its size in a unit that fits it (`combinations`, `products`,
   `pages`), when it started, how long it took, how it ended; and for each step its name, its duration,
   how many units it handled, how it ended. Time spent waiting on someone else's system is a step of
   its own, so "the supplier is slow" and "our code waits too long" are told apart. Keep at least 7
   days or 100 runs. Most apps already know this (the progress they show users, their log lines);
   store it instead of only printing it. Durations and counts only: never what a user asked for.
2. **Serve them** at `GET /ops/runs?operation=&since=&limit=` (newest first, at most 100):

   ```json
   { "runs": [
     { "operation": "search", "id": "r_812", "at": "2026-11-01T12:00:00Z", "units": 88, "s": 313.2, "ok": true,
       "steps": [ { "name": "calendar", "units": 8, "s": 98.1, "ok": true }, { "name": "grid", "units": 4, "s": 120.4, "ok": true } ] }
   ] }
   ```

   `units` and `s` (seconds) are numbers; a step's `units` may be in its own unit (stays, weeks), and a
   step may carry extra counts of known causes (`"empty": 3`). A cancelled run has `ok: false,
   cancelled: true` and is left out of speed. Keep 7 days or the last 100 runs per operation. Bad
   params answer 400. Split an operation whose kinds have different fixed costs (one-way and round trip).
3. **Declare the operations** in the manifest, so the operator knows what to ask for and the AI what
   it is looking at; say in `context` what durations are normal and when slower is expected
   ("with Google rate-limiting a search takes twice as long; that is not a fault"):

   ```json
   "operations": [
     { "name": "search", "description": "One fare search over a range of dates and stays", "unit": "combinations",
       "steps": [ { "name": "calendar", "unit": "stays" }, { "name": "grid", "unit": "weeks" } ] }
   ]
   ```

The operator then opens `slow` (subject `search` or `search.calendar`) when the recent duration per
unit is well above that operation's or step's own baseline, and its AI reads `/ops/runs` when it
investigates. An app does not report `slow` itself, with one exception: a hard limit its users feel
(a search hitting the page's timeout) is the app's own check, under its own id.

`GET /ops/metrics` MAY add a histogram `<app>_step_seconds{operation, step}` for long-term trends.

## `GET /ops/metrics` (optional)

Prometheus text format (`text/plain; version=0.0.4`). Counters and gauges the app already has. The
operator adds an `app` label when it scrapes. Not needed for any level.

## Heartbeats (operator side)

A scheduled job tells the operator it ran, at the end of each run:

```bash
curl -fsS -m 10 -X POST -H "Authorization: Bearer $HEARTBEAT_TOKEN" "$HEARTBEAT_URL/<app>/<job>?success=true"
# on failure:
curl -fsS -m 10 -X POST -H "Authorization: Bearer $HEARTBEAT_TOKEN" "$HEARTBEAT_URL/<app>/<job>?success=false&error=<what>"
```

`HEARTBEAT_URL` and `HEARTBEAT_TOKEN` come from the operator. The operator knows from its own
configuration how often each job should run, and opens `heartbeat_missed` when a beat is late and
`job_failed` when a beat says it failed. A heartbeat MUST NOT block or fail the job.

## Security notes for app authors

- The token gives read access to health, manifest and tools, and the right to *request* actions.
  The app's preconditions, limits and `409` are what make a stolen token survivable: design actions so
  that running one at the wrong time is refused, not harmful.
- Never declare an action that takes free text to execute (a shell command, SQL, a URL to fetch).
  Params are values for a fixed operation.
- Tool replies are read by a model. Do not echo user-controlled text you would not show the owner;
  the operator treats tool output as untrusted, but less of it is better.
- Keep `/ops/*` off public caches; the routes are per-request and behind a token.

## Versioning

This document is `0.4`. Until `1.0`, fields may be added; a removal or a change of meaning bumps the
minor version and is listed in [`CHANGES.md`](CHANGES.md). Operators ignore fields they do not know;
apps ignore body fields they do not know.

Open before 1.0: batch actions (`targets[]` with one approval for many objects); typed params with a
full JSON Schema; whether an operator may propose `rollback` on its own after a failed `verify`.
