# OPStead

**Care for the apps you ship.** Building and deploying an app is easy now; keeping ten of them
running is not. OPStead is an ops contract an app serves about itself, and an operator that reads it:
it watches, keeps one ledger of problems, tells you once per change, lets an AI investigate, and runs
only the fixes the app itself declared safe, asking you first when they matter.

*OPS* and *stead* share the S: a homestead for your apps' ops, and something that stands you in good stead.

## Status

Early. What is here now:

| Piece | State |
|---|---|
| [The contract](spec/CONTRACT.md), version 0.1, with [JSON Schemas](spec/schema) and [examples](spec/examples) | written |
| [`opstead check`](packages/opstead) | on npm: tells you how far an app follows the contract |
| [An agent skill](skill/opstead/SKILL.md) that adds the contract to an app (Claude Code, Codex) | written; tried on a sample app (level 3 with no hand edits) |
| The operator (ledger, notices, AI investigation, approvals, map) | runs privately; to be opened here once it no longer depends on one setup |
| An iOS app for notices and approvals | later |

```bash
npx opstead check https://my-app.example --token "$OPS_TOKEN"
```

## Let your coding agent do it

Copy the skill into your agent's skills folder, then ask it to "make this app watchable by OPStead":

```bash
# Claude Code (all projects; or .claude/skills/ inside one project)
git clone --depth 1 https://github.com/opstead/opstead /tmp/opstead && cp -R /tmp/opstead/skill/opstead ~/.claude/skills/
# Codex
cp -R /tmp/opstead/skill/opstead ~/.codex/skills/
```

The agent reads the app, writes `/ops/health`, the manifest and read-only tools, asks you before
adding any action, and checks its work with `npx opstead check`.

## The idea in one table

| Level | The app serves | What an operator can then do |
|---|---|---|
| 1 health | `GET /ops/health`: what is wrong, one check per thing | one problem per thing, told once per change |
| 2 shape | `GET /ops/manifest` with `components` | a map of the app; the AI knows where a problem sits |
| 3 knowledge | `context` and read-only `tools` | the AI investigates with the app's own data |
| 4 hands | `actions` with risk, limit, rollback, dry run | fixes proposed by the AI; low risk runs, medium asks you, high never |

The app stays in charge: it declares what may be done, and re-checks its own preconditions before doing it.

## Licence

MIT.
