# OPStead

**Care for the apps you ship.** Building and deploying an app is easy now; keeping ten of them
running is not. OPStead is an ops contract an app serves about itself, and an operator that reads it:
it watches, keeps one ledger of problems, tells you once per change, lets an AI investigate, and runs
only the fixes the app itself declared safe, asking you first when they matter.

This package is the first piece: `opstead check`, which tells you how far an app follows the contract.
The operator itself is not published yet.

```bash
npx opstead check https://my-app.example --token "$OPS_TOKEN"
```

```
my-app: level 3 (knowledge)
  ✓ auth: /ops/* refuses requests without the token
  ✓ metrics: /ops/metrics answers
  ! manifest.components[db]: nothing watches it: no checks, launchd, job or probe; it shows as not watched

Next: Declare actions with risk, limit, rollback, dry_run, and serve POST /ops/actions/<name> …
```

`--json` gives the same report for agents. The exit code is 0 when nothing is wrong, 1 when
something is, 2 when the app could not be reached. It only reads: tools and actions are never called.

When the operator gave you a prompt with an enrolment link, `connect` trades it for the app's token
and writes it into the app's env file without printing it:

```bash
npx opstead connect https://ops-hook.example/enrol/<code> --env .env --app-url http://127.0.0.1:3000
```

The link works once, within a day. `--app-url` is where the app answers `/ops/` as reachable from
the operator. When production takes its settings from CI secrets rather than that file, copy them
there from the file without printing them, e.g. `grep '^OPS_TOKEN=' .env | cut -d= -f2- | gh secret set OPS_TOKEN`.

## The levels

| Level | The app serves | What an operator can then do |
|---|---|---|
| 1 health | `GET /ops/health`: `{app, version, status, checks: [{id, level, subject?, detail, data?}]}` | one problem per thing that is wrong (`id` + `subject`), told once per change |
| 2 shape | `GET /ops/manifest` with `components`: `{id, kind, depends_on, checks}`, and `providers` with at least the `hosting` one: `{kind, name, what?, serves?}` | a map of the app; the AI knows where a problem sits, and a host's or edge's trouble is told above the parts it serves |
| 3 knowledge | `context` and read-only `tools` in the manifest | the AI investigates with the app's own data and knows what is normal |
| 4 hands | `actions` with `risk`, `limit`, `rollback`, `dry_run`; `POST /ops/actions/<name>` | the AI proposes fixes; low risk runs, medium asks you, high never; the app re-checks its preconditions and answers 409 when they do not hold |

All routes are under `/ops/` behind one bearer token. `GET /ops/metrics` (Prometheus text) is optional.

### A health reply

```json
{
  "app": "shop",
  "version": "3c49e78",
  "status": "warn",
  "checks": [
    { "id": "db", "level": "ok" },
    { "id": "stale", "level": "warn", "subject": "supplier-a", "detail": "713 of 1370 products not updated in 24 h", "data": { "stale": 713 } }
  ]
}
```

`id` is the kind of check (few, stable, snake_case). `subject` is what it is about; together they are
the problem's identity. `detail` is one English sentence. Report `ok` checks too.

### An action

```json
{
  "name": "disable_product",
  "description": "Hide a product whose supplier page is gone",
  "params": { "product_id": { "type": "uuid", "required": true } },
  "risk": "medium",
  "limit": "30/1d",
  "rollback": "enable_product",
  "dry_run": true
}
```

## Status

Early. The contract may still change before 1.0; `opstead check` follows it.

MIT licence.
