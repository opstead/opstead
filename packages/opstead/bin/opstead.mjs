#!/usr/bin/env node
// @ts-check
import { readFileSync } from "node:fs";
import { checkApp, LEVEL_NAMES, NEXT } from "../lib/check.mjs";

const HELP = `opstead: care for the apps you ship

Usage:
  opstead check <url> [--token <token>] [--json]

  Checks the app at <url> against the OPStead contract (/ops/health, /ops/manifest,
  /ops/metrics) and says which level it reaches:
    1 health     the app judges itself on /ops/health
    2 shape      components: what it is made of and what depends on what
    3 knowledge  context and read-only tools for the AI
    4 hands      actions with risk, limits, rollback and verification
  It only reads; tools and actions are never called.

  --token  the bearer the app expects on /ops/* (default: $OPSTEAD_TOKEN, then $OPS_TOKEN)
  --json   machine-readable report (for agents)

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
const [cmd, url] = args;

if (cmd !== "check" || !url || args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(cmd === undefined || args.includes("--help") || args.includes("-h") ? 0 : 2);
}

const report = await checkApp(url, { token });
const errors = report.findings.filter((f) => f.level === "error").length;
const unreachable = report.level === 0 && report.findings.some((f) => f.where === "health" && f.level === "error");

if (json) {
  console.log(JSON.stringify({ ...report, level_name: LEVEL_NAMES[report.level], next: NEXT[report.level] || null, errors }, null, 2));
} else {
  const tty = process.stdout.isTTY;
  const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const mark = { error: c(31, "✗"), warn: c(33, "!"), ok: c(32, "✓") };
  console.log(`${report.app ?? report.url}: level ${report.level} (${LEVEL_NAMES[report.level]})`);
  for (const f of report.findings) console.log(`  ${mark[f.level]} ${f.where}: ${f.message}`);
  if (NEXT[report.level]) console.log(`\nNext: ${NEXT[report.level]}`);
}
process.exit(unreachable ? 2 : errors ? 1 : 0);
