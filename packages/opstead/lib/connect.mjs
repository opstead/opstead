// @ts-check
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Enrolment: the one-time code in an operator's prompt traded for the app's token, written straight
 * into the app's env file. The values never reach the terminal, so an agent never sees or pastes them.
 */

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
 * @param {string} enrolUrl the operator's /enrol/<code> link from the prompt
 * @param {{ env: string, appUrl?: string, fetch?: typeof fetch }} opts
 * @returns {Promise<{ name: string, app_url: string | null, written: string[] }>}
 */
export async function connect(enrolUrl, opts) {
  const u = new URL(enrolUrl);
  if (!/^\/enrol\/[A-Za-z0-9_-]{20,}$/.test(u.pathname)) throw new Error("that is not an enrolment link (…/enrol/<code>)");
  if (opts.appUrl) u.searchParams.set("url", opts.appUrl);
  const res = await (opts.fetch ?? fetch)(u.href, { method: "POST", signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new Error("the operator does not know this code: it was used already or is older than a day; make a new link on the operator's page");
  if (!res.ok) throw new Error(`the operator answered HTTP ${res.status}`);
  /** @type {{ name: string, token: string, app_url: string | null, heartbeat_url?: string, heartbeat_token?: string }} */
  const r = await res.json();
  /** @type {Record<string, string>} */
  const values = { OPS_TOKEN: r.token };
  if (r.heartbeat_url && r.heartbeat_token) Object.assign(values, { HEARTBEAT_URL: r.heartbeat_url, HEARTBEAT_TOKEN: r.heartbeat_token });
  const had = existsSync(opts.env);
  writeFileSync(opts.env, setEnv(had ? readFileSync(opts.env, "utf8") : "", values), had ? undefined : { mode: 0o600 });
  if (!had) chmodSync(opts.env, 0o600);
  return { name: r.name, app_url: r.app_url, written: Object.keys(values) };
}
