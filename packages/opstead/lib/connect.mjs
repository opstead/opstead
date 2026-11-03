// @ts-check
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Enrolment: the one-time code in an operator's prompt traded for the app's token (and its deploy
 * token), written straight into the app's env file; the deploy settings can go on into the repo's CI
 * secrets. The values never reach the terminal, so an agent never sees or pastes them.
 */

/** What the pipeline needs to post deploy events, and all CI ever gets: never OPS_TOKEN. */
export const DEPLOY_NAMES = ["OPS_DEPLOY_TOKEN", "OPS_DEPLOY_URL"];

/**
 * Sets each name in an env file's text: an existing line is replaced in place, a new one appended.
 * @param {string} text
 * @param {Record<string, string>} values
 */
export function setEnv(text, values) {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const i = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(l));
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Reads one name from an env file's text (the last assignment wins, quotes dropped).
 * @param {string} text
 * @param {string} name
 * @returns {string | undefined}
 */
export function getEnv(text, name) {
  let value;
  for (const l of text.split("\n")) {
    const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`).exec(l);
    if (m) value = m[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return value || undefined;
}

/**
 * @param {string} enrolUrl the operator's /enrol/<code> link from the prompt
 * @param {{ env: string, appUrl?: string, fetch?: typeof fetch }} opts
 * @returns {Promise<{ name: string, app_url: string | null, written: string[], deploy: boolean }>}
 */
export async function connect(enrolUrl, opts) {
  const u = new URL(enrolUrl);
  if (!/^\/enrol\/[A-Za-z0-9_-]{20,}$/.test(u.pathname)) throw new Error("that is not an enrolment link (…/enrol/<code>)");
  if (opts.appUrl) u.searchParams.set("url", opts.appUrl);
  const res = await (opts.fetch ?? fetch)(u.href, { method: "POST", signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new Error("the operator does not know this code: it was used already or is older than a day; make a new link on the operator's page");
  if (!res.ok) throw new Error(`the operator answered HTTP ${res.status}`);
  /** @type {{ name: string, token: string, app_url: string | null, heartbeat_url?: string, heartbeat_token?: string, deploy_url?: string, deploy_token?: string }} */
  const r = await res.json();
  /** @type {Record<string, string>} */
  const values = { OPS_TOKEN: r.token };
  if (r.heartbeat_url && r.heartbeat_token) Object.assign(values, { HEARTBEAT_URL: r.heartbeat_url, HEARTBEAT_TOKEN: r.heartbeat_token });
  // An operator from before deploy events sends no deploy token; enrolment works without it.
  const deploy = typeof r.deploy_token === "string" && r.deploy_token !== "" && typeof r.deploy_url === "string" && /^https?:\/\//.test(r.deploy_url);
  if (deploy) Object.assign(values, { OPS_DEPLOY_TOKEN: r.deploy_token, OPS_DEPLOY_URL: r.deploy_url });
  const had = existsSync(opts.env);
  writeFileSync(opts.env, setEnv(had ? readFileSync(opts.env, "utf8") : "", values), had ? undefined : { mode: 0o600 });
  if (!had) chmodSync(opts.env, 0o600);
  return { name: r.name, app_url: r.app_url, written: Object.keys(values), deploy };
}

/**
 * @typedef {(cmd: string, args: string[], input: string) => { status: number | null, stderr: string, error?: Error }} Runner
 */

/** @type {Runner} */
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, stdio: ["pipe", "ignore", "pipe"], encoding: "utf8", timeout: 60_000 });
  return { status: r.status, stderr: r.stderr ?? "", error: r.error };
};

/**
 * Copies the deploy settings from the env file into the repository's CI secrets. The values go to
 * `gh` on its standard input, never as an argument, so they appear in no output, process list or
 * shell history.
 * @param {{ env: string, ci: string, repo?: string, run?: Runner }} opts
 * @returns {string[]} the names set
 */
export function setCiSecrets(opts) {
  if (opts.ci !== "github") throw new Error(`--ci ${opts.ci}: only github is supported; set ${DEPLOY_NAMES.join(" and ")} in your CI's secrets from ${opts.env} by hand`);
  const text = existsSync(opts.env) ? readFileSync(opts.env, "utf8") : "";
  const missing = DEPLOY_NAMES.filter((n) => !getEnv(text, n));
  if (missing.length) throw new Error(`${opts.env} has no ${missing.join(" or ")}: enrol with a link from an operator that hands out deploy tokens first`);
  const set = [];
  for (const name of DEPLOY_NAMES) {
    const args = ["secret", "set", name, ...(opts.repo ? ["--repo", opts.repo] : [])];
    const r = (opts.run ?? run)("gh", args, /** @type {string} */ (getEnv(text, name)));
    if (r.error && /** @type {any} */ (r.error).code === "ENOENT") throw new Error("the GitHub CLI (gh) is not installed: install it and run `gh auth login`, or set the secrets by hand");
    if (r.error || r.status !== 0) {
      const why = (r.stderr || r.error?.message || `exit ${r.status}`).trim().split("\n").at(-1);
      throw new Error(`gh secret set ${name} failed${set.length ? ` (${set.join(", ")} set)` : ""}: ${why}`);
    }
    set.push(name);
  }
  return set;
}
