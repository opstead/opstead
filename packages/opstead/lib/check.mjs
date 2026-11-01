// @ts-check
/**
 * Checks an app against the OPStead contract and says which level it reaches:
 * 1 health (/ops/health), 2 shape (components), 3 knowledge (context, tools), 4 hands (actions).
 * A level counts only when every level below it holds and it has no errors. Reads only: tools and
 * actions are never called.
 */

export const KINDS = ["service", "job", "store", "external", "ui"];
export const LEVELS = ["ok", "warn", "bad"];
export const RISKS = ["low", "medium", "high"];
const ID = /^[a-z][a-z0-9_]*$/;
const DURATION = /^\d+(?:\.\d+)?\s*(?:ms|s|m|h|d)$/;
/** Checks the operator adds itself (launchd, heartbeats, probes); an app never reports them. */
const OPERATOR_CHECKS = ["service_down", "heartbeat_missed", "job_failed", "http_down", "http_slow", "slow"];
const LIMIT = /^\d+\s*\/\s*\d+\s*(?:ms|s|m|h|d)$/;

/** @typedef {{ level: "error" | "warn" | "ok", where: string, message: string }} Finding */
/** @typedef {{ url: string, app?: string, level: number, findings: Finding[], metrics?: boolean }} Report */

const isObj = (/** @type {unknown} */ v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (/** @type {unknown} */ v) => typeof v === "string" && v.trim() !== "";

/**
 * @param {unknown} body
 * @returns {{ findings: Finding[], ids: Set<string> }}
 */
export function validateHealth(body) {
  /** @type {Finding[]} */
  const out = [];
  const ids = new Set();
  const err = (where, message) => out.push({ level: "error", where, message });
  const warn = (where, message) => out.push({ level: "warn", where, message });
  if (!isObj(body)) return { findings: [{ level: "error", where: "health", message: "the reply is not a JSON object" }], ids };
  const b = /** @type {Record<string, unknown>} */ (body);
  if (!Array.isArray(b.checks)) err("health.checks", "missing: an array of checks is required");
  if (!isStr(b.app)) warn("health.app", "missing: the app's name helps when one person runs many apps");
  if (b.version !== undefined && typeof b.version !== "string") warn("health.version", "should be a string (a commit or release)");
  if (b.status !== undefined && !LEVELS.includes(/** @type {string} */ (b.status))) err("health.status", `must be one of ${LEVELS.join(", ")}`);
  const checks = Array.isArray(b.checks) ? b.checks : [];
  if (Array.isArray(b.checks) && checks.length === 0) warn("health.checks", "empty: report ok-level checks too, so the owner can see what the app looks at");
  const seen = new Set();
  let worst = 0;
  checks.forEach((c, i) => {
    const at = `health.checks[${i}]`;
    if (!isObj(c)) return err(at, "not an object");
    if (!isStr(c.id)) return err(`${at}.id`, "missing");
    const where = `health.checks[${c.id}${isStr(c.subject) ? ` · ${c.subject}` : ""}]`;
    if (!ID.test(c.id)) warn(`${where}.id`, "use a stable snake_case id (it is part of the problem's identity)");
    if (!LEVELS.includes(c.level)) err(`${where}.level`, `must be one of ${LEVELS.join(", ")}`);
    else worst = Math.max(worst, LEVELS.indexOf(c.level));
    if (c.subject !== undefined && typeof c.subject !== "string") err(`${where}.subject`, "must be a string (the thing the check is about)");
    if (c.level !== "ok" && !isStr(c.detail)) warn(`${where}.detail`, "missing: one English sentence saying what is wrong");
    if (c.data !== undefined && !isObj(c.data)) err(`${where}.data`, "must be an object of numbers and short values");
    const key = `${c.id}\u0000${c.subject ?? ""}`;
    if (seen.has(key)) err(where, "appears twice: id + subject must be unique, it is how a problem is told apart");
    seen.add(key);
    ids.add(c.id);
  });
  if (LEVELS.includes(/** @type {string} */ (b.status)) && checks.length && LEVELS.indexOf(/** @type {string} */ (b.status)) < worst) warn("health.status", `says ${b.status} but a check is ${LEVELS[worst]}`);
  return { findings: out, ids };
}

/**
 * @param {Record<string, unknown> | undefined} params
 * @param {string} at
 * @param {Finding[]} out
 * @returns {boolean} whether it found an error
 */
function validateParams(params, at, out) {
  if (params === undefined) return false;
  if (!isObj(params)) return out.push({ level: "error", where: at, message: "must be an object: {name: {type, required?, description?}}" }) > 0;
  let bad = false;
  for (const [name, p] of Object.entries(params)) {
    if (!isObj(p) || !isStr(/** @type {Record<string, unknown>} */ (p).type)) bad = out.push({ level: "error", where: `${at}.${name}`, message: "needs a type (string, number, boolean, uuid …)" }) > 0;
  }
  return bad;
}

/**
 * @param {unknown} body
 * @param {Set<string>} healthIds the check ids /ops/health reported now
 * @returns {{ findings: Finding[], has: { components: boolean, knowledge: boolean, actions: boolean }, errorsAt: { 2: boolean, 3: boolean, 4: boolean } }}
 */
export function validateManifest(body, healthIds) {
  /** @type {Finding[]} */
  const out = [];
  const errorsAt = { 2: false, 3: false, 4: false };
  const has = { components: false, knowledge: false, actions: false };
  const add = (/** @type {2|3|4} */ lv, /** @type {"error"|"warn"} */ level, where, message) => {
    out.push({ level, where, message });
    if (level === "error") errorsAt[lv] = true;
  };
  if (!isObj(body)) {
    out.push({ level: "error", where: "manifest", message: "the reply is not a JSON object" });
    return { findings: out, has, errorsAt: { 2: true, 3: true, 4: true } };
  }
  const m = /** @type {Record<string, unknown>} */ (body);

  if (m.contract === undefined) out.push({ level: "warn", where: "manifest.contract", message: 'missing: say which contract version the app follows ("0.1")' });
  else if (typeof m.contract !== "string") out.push({ level: "warn", where: "manifest.contract", message: 'must be a string like "0.1"' });

  // Level 2: components.
  const comps = m.components === undefined ? [] : m.components;
  if (!Array.isArray(comps)) add(2, "error", "manifest.components", "must be an array");
  else if (comps.length) {
    has.components = true;
    const ids = new Set(comps.filter((c) => isObj(c) && isStr(c.id)).map((c) => c.id));
    const dup = new Set();
    const unseen = new Set();
    comps.forEach((c, i) => {
      if (!isObj(c) || !isStr(c.id)) return add(2, "error", `manifest.components[${i}]`, "needs an id");
      const at = `manifest.components[${c.id}]`;
      if (dup.has(c.id)) add(2, "error", at, "id appears twice");
      dup.add(c.id);
      if (!ID.test(c.id)) add(2, "warn", `${at}.id`, "use snake_case (owner_page, not owner-page or a:b)");
      if (c.launchd !== undefined && c.service === undefined) add(2, "warn", `${at}.launchd`, "write service instead (launchd is the older spelling)");
      if (!KINDS.includes(c.kind)) add(2, "error", `${at}.kind`, `must be one of ${KINDS.join(", ")}`);
      if (c.depends_on !== undefined && !Array.isArray(c.depends_on)) add(2, "error", `${at}.depends_on`, "must be an array of component ids");
      for (const d of Array.isArray(c.depends_on) ? c.depends_on : []) if (!ids.has(d)) add(2, "error", `${at}.depends_on`, `"${d}" is not a component id`);
      if (c.checks !== undefined && !Array.isArray(c.checks)) add(2, "error", `${at}.checks`, "must be an array of {id, subject?}");
      for (const k of Array.isArray(c.checks) ? c.checks : []) {
        if (!isObj(k) || !isStr(k.id)) add(2, "error", `${at}.checks`, "each entry needs an id");
        else if (!healthIds.has(k.id) && !OPERATOR_CHECKS.includes(k.id)) unseen.add(k.id);
      }
      // An external that stands for another of the owner's apps is watched there.
      const watched = (Array.isArray(c.checks) && c.checks.length) || c.service || c.launchd || c.job || (c.probe && c.url) || isStr(c.app);
      if (!watched && c.kind !== "store") add(2, "warn", at, "nothing watches it: no checks, service, job or probe; it shows as not watched");
      if (c.probe && !isStr(c.url)) add(2, "error", `${at}.probe`, "needs a url to open");
      if (c.url !== undefined && !isStr(c.url)) add(2, "error", `${at}.url`, "must be a URL");
    });
    if (unseen.size) {
      const list = [...unseen];
      add(2, "warn", "manifest.components", `${list.length} check id${list.length > 1 ? "s" : ""} named here ${list.length > 1 ? "are" : "is"} not in /ops/health right now (${list.slice(0, 8).join(", ")}${list.length > 8 ? ", …" : ""}): fine if reported only when failing; reporting them as ok shows the owner they are watched, and catches a misspelt id`);
    }
  }

  // Level 3: context and tools.
  if (isStr(m.context)) {
    has.knowledge = true;
    if (/** @type {string} */ (m.context).length < 80) add(3, "warn", "manifest.context", "short: say what the app does, what is normal, and what is not a fault");
  } else if (m.context !== undefined) add(3, "error", "manifest.context", "must be a string");
  const tools = m.tools === undefined ? [] : m.tools;
  if (!Array.isArray(tools)) add(3, "error", "manifest.tools", "must be an array");
  else {
    const names = new Set();
    tools.forEach((t, i) => {
      if (!isObj(t) || !isStr(t.name)) return add(3, "error", `manifest.tools[${i}]`, "needs a name");
      const at = `manifest.tools[${t.name}]`;
      if (names.has(t.name)) add(3, "error", at, "name appears twice");
      names.add(t.name);
      if (!ID.test(t.name)) add(3, "warn", `${at}.name`, "use snake_case (it becomes a URL path)");
      if (!isStr(t.description)) add(3, "error", `${at}.description`, "missing: the AI picks tools by their description");
      if (validateParams(t.params, `${at}.params`, out)) errorsAt[3] = true;
      if (t.network !== undefined && typeof t.network !== "boolean") add(3, "error", `${at}.network`, "must be true or false");
    });
    if (has.knowledge && !tools.length) add(3, "warn", "manifest.tools", "none: read-only tools let the AI look at the app's own data");
  }
  for (const c of Array.isArray(comps) ? comps : []) if (isObj(c) && isStr(c.id) && c.description !== undefined && !isStr(c.description)) add(3, "error", `manifest.components[${c.id}].description`, "must be a string");
  if (m.operations !== undefined) {
    if (!Array.isArray(m.operations)) add(3, "error", "manifest.operations", "must be an array of {name, description?, unit?, steps?}");
    else m.operations.forEach((o, i) => {
      if (!isObj(o) || !isStr(o.name)) return add(3, "error", `manifest.operations[${i}]`, "needs a name");
      const at = `manifest.operations[${o.name}]`;
      if (!ID.test(o.name)) add(3, "warn", `${at}.name`, "use snake_case (it is the subject of the operator's slow check)");
      if (!isStr(o.unit)) add(3, "warn", `${at}.unit`, "missing: what one unit of size is (combinations, products), so runs of different sizes compare");
      if (o.steps !== undefined && !(Array.isArray(o.steps) && o.steps.every((x) => isObj(x) && isStr(x.name)))) add(3, "error", `${at}.steps`, "must be an array of {name, unit?}");
    });
  }

  // Level 4: actions.
  const actions = m.actions === undefined ? [] : m.actions;
  if (!Array.isArray(actions)) add(4, "error", "manifest.actions", "must be an array");
  else if (actions.length) {
    has.actions = true;
    const names = new Set(actions.filter((a) => isObj(a) && isStr(a.name)).map((a) => a.name));
    const dup = new Set();
    actions.forEach((a, i) => {
      if (!isObj(a) || !isStr(a.name)) return add(4, "error", `manifest.actions[${i}]`, "needs a name");
      const at = `manifest.actions[${a.name}]`;
      if (dup.has(a.name)) add(4, "error", at, "name appears twice");
      dup.add(a.name);
      if (!ID.test(a.name)) add(4, "warn", `${at}.name`, "use snake_case (it becomes a URL path)");
      if (!isStr(a.description)) add(4, "error", `${at}.description`, "missing: say what it changes");
      if (!RISKS.includes(a.risk)) add(4, "error", `${at}.risk`, `required, one of ${RISKS.join(", ")}: low runs on its own, medium asks the owner, high never runs by default`);
      if (a.limit !== undefined && !(typeof a.limit === "string" && LIMIT.test(a.limit))) add(4, "error", `${at}.limit`, 'must look like "20/1d" (at most 20 a day)');
      if (a.limit === undefined && a.risk !== "high") add(4, "warn", `${at}.limit`, 'missing: say how often it may run, e.g. "1/45m"');
      if (a.rollback !== undefined && a.rollback !== null && !(isStr(a.rollback) && names.has(a.rollback))) add(4, "error", `${at}.rollback`, `"${a.rollback}" is not one of the actions`);
      if (a.dry_run !== undefined && typeof a.dry_run !== "boolean") add(4, "error", `${at}.dry_run`, "must be true or false");
      if (a.risk === "medium" && a.dry_run !== true) add(4, "warn", `${at}.dry_run`, "a medium-risk action is easier to approve when it can show what it would do");
      if (a.schedule !== undefined && !(typeof a.schedule === "string" && DURATION.test(a.schedule))) add(4, "error", `${at}.schedule`, 'must be a duration like "1d"');
      if (a.title !== undefined && !(isStr(a.title) && a.title.length <= 60)) add(4, "error", `${at}.title`, "must be a few words (at most 60 characters)");
      if (a.title === undefined) add(4, "warn", `${at}.title`, 'missing: a few plain words for the owner ("Sync this supplier now"); the description is for the AI');
      if (a.checks !== undefined) {
        if (!Array.isArray(a.checks) || !a.checks.every(isStr)) add(4, "error", `${at}.checks`, "must be a list of health check ids");
        else for (const id of a.checks) if (!healthIds.has(id) && !OPERATOR_CHECKS.includes(id)) add(4, "warn", `${at}.checks`, `"${id}" is not a check /ops/health reported now`);
      }
      if (validateParams(a.params, `${at}.params`, out)) errorsAt[4] = true;
    });
  }
  return { findings: out, has, errorsAt };
}

/**
 * @param {unknown} body a /ops/runs reply
 * @returns {string | null} what is wrong with it
 */
export function validateRuns(body) {
  if (!isObj(body) || !Array.isArray(/** @type {any} */ (body).runs)) return "/ops/runs must answer {runs: [...]}";
  for (const r of /** @type {any} */ (body).runs) {
    if (!isObj(r) || !isStr(r.operation) || !isStr(r.at) || typeof r.units !== "number" || typeof r.s !== "number" || typeof r.ok !== "boolean")
      return "each run needs operation, at, units (a number), s (seconds), ok";
    if (r.steps !== undefined && !(Array.isArray(r.steps) && r.steps.every((x) => isObj(x) && isStr(x.name) && typeof x.s === "number")))
      return `run ${r.id ?? r.at}: steps must be [{name, units?, s, ok?}]`;
  }
  return null;
}

/**
 * @param {string} url the app's base URL (where /ops/ lives)
 * @param {{ token?: string, fetch?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<Report>}
 */
export async function checkApp(url, opts = {}) {
  const base = url.replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  const timeout = opts.timeoutMs ?? 10_000;
  /** @type {Finding[]} */
  const findings = [];
  const headers = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  const get = (path, h = headers) => f(`${base}${path}`, { headers: { accept: "application/json", ...h }, signal: AbortSignal.timeout(timeout) });

  let health;
  try {
    const res = await get("/ops/health");
    if (!res.ok) {
      findings.push({ level: "error", where: "health", message: `/ops/health answered HTTP ${res.status}${res.status === 401 || res.status === 404 ? (opts.token ? " (is the token right?)" : " (pass --token)") : ""}` });
      return { url: base, level: 0, findings };
    }
    health = await res.json().catch(() => undefined);
  } catch (e) {
    findings.push({ level: "error", where: "health", message: `/ops/health: ${/** @type {Error} */ (e).message}` });
    return { url: base, level: 0, findings };
  }
  const h = validateHealth(health);
  findings.push(...h.findings);
  const app = isObj(health) && isStr(health.app) ? health.app : undefined;
  let level = h.findings.some((x) => x.level === "error") ? 0 : 1;

  if (opts.token) {
    // The routes must not answer without the token.
    const status = await get("/ops/health", {}).then((r) => r.status, () => 0);
    if (status >= 200 && status < 300) findings.push({ level: "error", where: "auth", message: "/ops/health answers without the token: put /ops/* behind it" });
    else if (status === 404) findings.push({ level: "ok", where: "auth", message: "/ops/* refuses requests without the token" });
    else findings.push({ level: "warn", where: "auth", message: `/ops/health answers ${status || "nothing"} without the token; answer 404, so the routes do not advertise themselves` });
  } else findings.push({ level: "warn", where: "auth", message: "/ops/health answered without a token: put /ops/* behind one (OPS_TOKEN)" });

  const metrics = await get("/ops/metrics").then((r) => r.ok, () => false);
  findings.push(metrics ? { level: "ok", where: "metrics", message: "/ops/metrics answers" } : { level: "ok", where: "metrics", message: "/ops/metrics not served (optional, needed for no level)" });

  let manifest;
  try {
    const res = await get("/ops/manifest");
    if (res.ok) manifest = await res.json().catch(() => null);
    else findings.push({ level: level ? "warn" : "error", where: "manifest", message: `/ops/manifest answered HTTP ${res.status}; it is needed for levels 2-4` });
  } catch (e) {
    findings.push({ level: "warn", where: "manifest", message: `/ops/manifest: ${/** @type {Error} */ (e).message}` });
  }
  if (manifest !== undefined) {
    const m = validateManifest(manifest, h.ids);
    findings.push(...m.findings);
    if (isObj(manifest) && Array.isArray(manifest.operations) && manifest.operations.length) {
      const runs = await get("/ops/runs?limit=5").then(async (r) => (r.ok ? r.json().catch(() => null) : r.status), () => 0);
      const bad = validateRuns(runs);
      if (typeof runs === "number") { m.findings.push({ level: "error", where: "runs", message: `operations are declared but /ops/runs answered ${runs || "nothing"}` }); m.errorsAt[3] = true; }
      else if (bad) { m.findings.push({ level: "error", where: "runs", message: bad }); m.errorsAt[3] = true; }
      else m.findings.push({ level: "ok", where: "runs", message: `/ops/runs answers (${runs.runs.length} recent)` });
      findings.push(m.findings.at(-1));
    }
    if (level >= 1 && m.has.components && !m.errorsAt[2]) level = 2;
    if (level >= 2 && m.has.knowledge && !m.errorsAt[3]) level = 3;
    if (level >= 3 && m.has.actions && !m.errorsAt[4]) level = 4;
  }
  return { url: base, app, level, findings, metrics };
}

export const LEVEL_NAMES = ["none", "health", "shape", "knowledge", "hands"];

/** What to do next to reach the level above. */
export const NEXT = [
  "Serve GET /ops/health: {app, version, status, checks: [{id, level, subject?, detail, data?}]} behind a bearer token.",
  "Serve GET /ops/manifest with components: what the app is made of, what each depends on, which checks are about it.",
  "Add context (what the app does, what is normal) and read-only tools to the manifest.",
  "Declare actions with risk, limit, rollback, dry_run, and serve POST /ops/actions/<name> that re-checks its preconditions (409 when they do not hold).",
  "",
];
