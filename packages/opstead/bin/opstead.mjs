#!/usr/bin/env node
// @ts-check
import { readFileSync } from "node:fs";
import { checkApp, LEVEL_NAMES } from "../lib/check.mjs";
import { connect, setCiSecrets } from "../lib/connect.mjs";

const HELP = `opstead: care for the apps you ship

Usage:
  opstead check <url> [--token <token>] [--json]
  opstead connect <enrol-link> [--env <file>] [--app-url <url>] [--ci github [--repo <owner/name>]]
  opstead connect --ci github [--env <file>] [--repo <owner/name>]

  Checks the app at <url> against the OPStead contract (/ops/health, /ops/manifest,
  /ops/metrics) and says which level it reaches:
    1 health     the app judges itself on /ops/health
    2 shape      components (what it is made of, what depends on what) and providers
                 (who hosts it, carries it, sends its mail)
    3 knowledge  context and read-only tools for the AI
    4 hands      actions with risk, limits, rollback and verification
  It only reads; tools and actions are never called.

  --token  the bearer the app expects on /ops/* (default: $OPSTEAD_TOKEN, then $OPS_TOKEN)
  --json   machine-readable report (for agents)

  connect  trades the one-time enrolment link from an operator's prompt for the app's token
           and writes OPS_TOKEN (and HEARTBEAT_URL, HEARTBEAT_TOKEN, OPS_DEPLOY_TOKEN,
           OPS_DEPLOY_URL) into the env file (default .env), never printing them. --app-url
           tells the operator where the app answers /ops/, as reachable from the operator.
           --ci github then sets OPS_DEPLOY_TOKEN and OPS_DEPLOY_URL as the repository's
           Actions secrets with \`gh secret set\` (the repo of the current directory, or
           --repo), from the env file, printing neither. Without a link it does only that.

Exit code: 0 when nothing is wrong, 1 when something is, 2 when the app could not be checked.`;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

if (args.includes("--version") || args.includes("-v")) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}
const json = args.includes("--json");
if (json) args.splice(args.indexOf("--json"), 1);
const token = flag("--token") ?? process.env.OPSTEAD_TOKEN ?? process.env.OPS_TOKEN;
const envFile = flag("--env") ?? ".env";
const appUrl = flag("--app-url");
const ci = flag("--ci");
const repo = flag("--repo");
const [cmd, url] = args;

if (cmd === "connect" && (url || ci)) {
  let deploy = true;
  if (url) {
    try {
      const r = await connect(url, { env: envFile, appUrl });
      deploy = r.deploy;
      console.log(`${r.name}: enrolled with the operator; wrote ${r.written.join(", ")} to ${envFile} (values not shown; keep the file out of git).`);
      console.log(`The operator asks /ops/ at ${r.app_url ?? "(not set: give --app-url, or set it on the operator's page)"}.`);
      if (!deploy) console.log("The operator sent no deploy token (it predates deploy events): everything else works. Once the operator is updated, a new enrolment link from this app's page there gives one.");
    } catch (e) {
      console.error(`opstead connect: ${/** @type {Error} */ (e).message}`);
      process.exit(2);
    }
  }
  if (ci && !deploy) console.log(`--ci ${ci}: skipped, there is no deploy token to set.`);
  else if (ci) {
    try {
      const set = setCiSecrets({ env: envFile, ci, repo });
      console.log(`Set ${set.join(" and ")} as Actions secrets${repo ? ` of ${repo}` : " of this directory's repository"} (values not shown).`);
    } catch (e) {
      console.error(`opstead connect: ${/** @type {Error} */ (e).message}`);
      if (url) console.error(`The env file is written; to try the secrets again: npx opstead connect --ci ${ci} --env ${envFile}${repo ? ` --repo ${repo}` : ""}`);
      process.exit(2);
    }
  }
  process.exit(0);
}

if (cmd !== "check" || !url || args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(cmd === undefined || args.includes("--help") || args.includes("-h") ? 0 : 2);
}

const report = await checkApp(url, { token });
const errors = report.findings.filter((f) => f.level === "error").length;
const unreachable = report.level === 0 && report.findings.some((f) => f.where === "health" && f.level === "error");

if (json) {
  console.log(JSON.stringify({ ...report, level_name: LEVEL_NAMES[report.level], next: report.next ?? null, errors }, null, 2));
} else {
  const tty = process.stdout.isTTY;
  const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const mark = { error: c(31, "✗"), warn: c(33, "!"), ok: c(32, "✓") };
  console.log(`${report.app ?? report.url}: level ${report.level} (${LEVEL_NAMES[report.level]})`);
  for (const f of report.findings) console.log(`  ${mark[f.level]} ${f.where}: ${f.message}`);
  if (report.next) console.log(`\nNext: ${report.next}`);
}
process.exit(unreachable ? 2 : errors ? 1 : 0);
