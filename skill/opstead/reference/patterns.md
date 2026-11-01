# Patterns

Small, dependency-free shapes to adapt to the app's own style. They are sketches: use the app's
logger, database client, config loader and test tools instead of the stand-ins here.

## The token

Node:

```js
import { timingSafeEqual } from "node:crypto";

/** True when the request carries OPS_TOKEN; false (answer 404) otherwise, or when no token is set. */
export function opsAuthorized(header) {
  const token = process.env.OPS_TOKEN;
  if (!token || typeof header !== "string") return false;
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}
```

Python:

```python
import hmac, os

def ops_authorized(header: str | None) -> bool:
    token = os.environ.get("OPS_TOKEN")
    if not token or not header or not header.lower().startswith("bearer "):
        return False
    return hmac.compare_digest(header[7:].encode(), token.encode())
```

## Health: compute checks safely

One check failing to compute must not break the reply.

```js
const LEVELS = ["ok", "warn", "bad"];

async function guarded(id, fn, subject) {
  try {
    return await fn();
  } catch (err) {
    return { id, subject, level: "bad", detail: `could not be checked: ${err.message}` };
  }
}

export async function health(deps) {
  const checks = (await Promise.all([
    guarded("db", async () => {
      const t0 = Date.now();
      await deps.db.query("SELECT 1");
      return { id: "db", level: "ok", detail: `the database answered in ${Date.now() - t0} ms` };
    }),
    guarded("stale", async () => {
      // The sync runs hourly; twice its period without a new row means it has stopped producing.
      const STALE_AFTER_H = 2;
      const { rows: [r] } = await deps.db.query("SELECT extract(epoch FROM now() - max(updated_at)) / 3600 AS h FROM prices");
      const h = Number(r?.h ?? Infinity);
      return { id: "stale", level: h > STALE_AFTER_H * 3 ? "bad" : h > STALE_AFTER_H ? "warn" : "ok", detail: `the newest price is ${h.toFixed(1)} h old`, data: { hours: h } };
    }),
  ])).flat().filter(Boolean);
  const worst = checks.reduce((w, c) => Math.max(w, LEVELS.indexOf(c.level)), 0);
  return { app: "shop", version: process.env.GIT_SHA ?? "dev", at: new Date().toISOString(), status: LEVELS[worst], checks };
}
```

## Plain `node:http`

```js
import { createServer } from "node:http";

async function opsRoute(req, res, url, deps) {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  if (!opsAuthorized(req.headers.authorization)) return send(404);
  const tool = url.pathname.match(/^\/ops\/tools\/([a-z0-9_]+)$/);
  const action = url.pathname.match(/^\/ops\/actions\/([a-z0-9_]+)$/);
  if (req.method === "GET" && url.pathname === "/ops/health") return send(200, await health(deps));
  if (req.method === "GET" && url.pathname === "/ops/manifest") return send(200, manifest);
  if (req.method === "GET" && tool) {
    const { status, body } = await runTool(tool[1], Object.fromEntries(url.searchParams), deps);
    return send(status, body);
  }
  if (req.method === "POST" && action) {
    let body = {};
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    } catch {
      return send(400, { error: "the body is not JSON" });
    }
    const { status, body: reply } = await runAction(action[1], body, req.headers["idempotency-key"], deps);
    return send(status, reply);
  }
  return send(404);
}

// In the app's handler, before its own routes:
//   if (url.pathname.startsWith("/ops/")) return opsRoute(req, res, url, deps);
```

## Tools: the one runner

Params arrive as query strings: check and convert them in one place, with a hard cap on row counts.

```js
const MAX_ROWS = 50;
const tools = {
  stale_products: {
    params: { supplier: { type: "string" }, limit: { type: "integer" } },
    run: ({ supplier, limit = 20 }, deps) => deps.db.staleProducts({ supplier, limit: Math.min(limit, MAX_ROWS) }),
  },
};

export async function runTool(name, query, deps) {
  const tool = tools[name];
  if (!tool) return { status: 404, body: { error: `unknown tool ${name}` } };
  const bad = checkParams(tool.params, query);
  if (bad) return { status: 400, body: { error: bad } };
  const params = convertParams(tool.params, query);
  return { status: 200, body: await tool.run(params, deps) };
}

function convertParams(spec = {}, query) {
  const out = {};
  for (const [name, p] of Object.entries(spec)) {
    const v = query[name];
    if (v === undefined || v === "") continue;
    out[name] = p.type === "integer" || p.type === "int" ? Number.parseInt(v, 10) : p.type === "number" ? Number(v) : p.type === "boolean" ? v === "true" : v;
  }
  return out;
}
```

`checkParams` is the same function the action runner uses (below).

## Express

```js
import express from "express";
const ops = express.Router();
ops.use((req, res, next) => (opsAuthorized(req.get("authorization")) ? next() : res.status(404).end()));
ops.get("/health", async (_req, res) => res.json(await health(deps)));
ops.get("/manifest", (_req, res) => res.json(manifest));
ops.get("/tools/:name", async (req, res) => {
  const tool = tools[req.params.name];
  if (!tool) return res.status(404).json({ error: `unknown tool ${req.params.name}` });
  try {
    res.json(await tool(req.query));
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});
ops.post("/actions/:name", express.json(), async (req, res) => {
  const { status, body } = await runAction(req.params.name, req.body ?? {}, req.get("idempotency-key"));
  res.status(status).json(body);
});
app.use("/ops", ops);
```

## Fastify

```js
app.register(async (ops) => {
  ops.addHook("onRequest", async (req, reply) => {
    if (!opsAuthorized(req.headers.authorization)) return reply.code(404).send();
  });
  ops.get("/health", async () => health(deps));
  ops.get("/manifest", async () => manifest);
  ops.get("/tools/:name", async (req, reply) => { /* as in Express */ });
  ops.post("/actions/:name", async (req, reply) => {
    const { status, body } = await runAction(req.params.name, req.body ?? {}, req.headers["idempotency-key"]);
    return reply.code(status).send(body);
  });
}, { prefix: "/ops" });
```

## Hono (also Cloudflare Workers)

```js
const ops = new Hono();
ops.use("*", async (c, next) => (opsAuthorized(c.req.header("authorization")) ? next() : c.body(null, 404)));
ops.get("/health", async (c) => c.json(await health(deps)));
ops.get("/manifest", (c) => c.json(manifest));
ops.post("/actions/:name", async (c) => {
  const { status, body } = await runAction(c.req.param("name"), await c.req.json().catch(() => ({})), c.req.header("idempotency-key"));
  return c.json(body, status);
});
app.route("/ops", ops);
```

On Workers, `timingSafeEqual` comes from `crypto.subtle.timingSafeEqual` or a manual constant-time loop.

## FastAPI

```python
from fastapi import APIRouter, Depends, Header, HTTPException, Request

def require_ops(authorization: str | None = Header(None)):
    if not ops_authorized(authorization):
        raise HTTPException(status_code=404)

ops = APIRouter(prefix="/ops", dependencies=[Depends(require_ops)])

@ops.get("/health")
async def ops_health():
    return await health()

@ops.get("/manifest")
def ops_manifest():
    return MANIFEST

@ops.post("/actions/{name}")
async def ops_action(name: str, request: Request, idempotency_key: str | None = Header(None)):
    body = await request.json() if await request.body() else {}
    status, reply = await run_action(name, body, idempotency_key)
    return JSONResponse(reply, status_code=status)

app.include_router(ops)
```

## Flask

```python
ops = Blueprint("ops", __name__, url_prefix="/ops")

@ops.before_request
def guard():
    if not ops_authorized(request.headers.get("Authorization")):
        abort(404)

@ops.get("/health")
def ops_health():
    return jsonify(health())

app.register_blueprint(ops)
```

## Actions: the one runner

`checkParams` below also serves the tools. Every action goes through one function, so idempotency, limits, preconditions, dry run and the log
are never forgotten. Keep the idempotency answers in the app's database or a file (a table keyed by
the key, kept 24 h); the in-memory map below only shows the order and dies with the process. An action
that ends the process (a restart) writes its answer there before it acts.

```js
const seen = new Map(); // key -> { at, status, body }
const DAY = 86_400_000;

const actions = {
  hide_product: {
    params: { product_id: { type: "uuid", required: true } },
    /** Returns null when it may run, else the reason it may not. */
    async precondition({ product_id }, deps) {
      const p = await deps.products.get(product_id);
      if (!p) return "no such product";
      if (p.hidden) return "it is already hidden";
      if (await deps.supplier.answeredRecently(p)) return "its supplier page answered 200 in the last day";
      return null;
    },
    async describe({ product_id }) {
      return `set products.hidden = true for ${product_id}`;
    },
    async run({ product_id }, deps) {
      await deps.products.hide(product_id);
      return { result: "hidden", verify: { check: "stale", subject: "supplier-a", after: "40m" } };
    },
  },
};

export async function runAction(name, body, key, deps) {
  const action = actions[name];
  if (!action) return { status: 404, body: { error: `unknown action ${name}` } };
  const now = Date.now();
  for (const [k, v] of seen) if (now - v.at > DAY) seen.delete(k);
  // 1. A retry gets the first answer, before anything else is looked at.
  if (key && seen.has(key)) {
    const first = seen.get(key);
    return first.running ? { status: 409, body: { error: "already running" } } : first;
  }

  const { reason, dry_run, ...params } = body; // other unknown fields are ignored
  const bad = checkParams(action.params, params);
  if (bad) return { status: 400, body: { error: bad } };
  const used = await deps.log.countSince(name, now - limitWindowMs(action.limit));
  if (used >= limitCount(action.limit)) return { status: 409, body: { error: `limit of ${action.limit} reached` } };
  const why = await action.precondition(params, deps);
  if (why) return { status: 409, body: { error: why } };
  if (dry_run === true) return { status: 200, body: { dry_run: true, would: await action.describe(params, deps) } };

  if (key) seen.set(key, { at: now, running: true });
  let reply;
  try {
    reply = { status: 200, body: await action.run(params, deps) };
  } catch (err) {
    reply = { status: 500, body: { error: err.message } };
  }
  await deps.log.action({ name, params, reason, status: reply.status, result: reply.body.result ?? reply.body.error });
  if (key) seen.set(key, { at: now, ...reply });
  return reply;
}

// "3/1d" -> 3 and one day in ms.
const UNIT = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
const limitCount = (limit) => (limit ? Number(limit.split("/")[0]) : Infinity);
function limitWindowMs(limit) {
  const m = /\/\s*(\d+)\s*(ms|s|m|h|d)$/.exec(limit ?? "");
  return m ? Number(m[1]) * UNIT[m[2]] : 0;
}

function checkParams(spec = {}, params) {
  for (const [name, p] of Object.entries(spec)) {
    const v = params[name];
    if (v === undefined || v === null || v === "") {
      if (p.required) return `${name} is required`;
      continue;
    }
    if (p.type === "uuid" && !/^[0-9a-f-]{36}$/i.test(String(v))) return `${name} must be a uuid`;
    if ((p.type === "integer" || p.type === "int") && !Number.isInteger(Number(v))) return `${name} must be an integer`;
  }
  // Fields not declared are ignored: the operator adds reason and dry_run, later versions may add more.
  return null;
}
```

The manifest's `actions` entries are written next to this table (name, description, params, risk,
limit, rollback, dry_run) so they cannot drift apart; derive one from the other when the language allows.

## Heartbeats at the end of a job

Shell (cron, systemd, launchd):

```bash
run_the_job && ok=true || ok=false
[ -n "${HEARTBEAT_URL:-}" ] && curl -fsS -m 10 -X POST -H "Authorization: Bearer $HEARTBEAT_TOKEN" \
  "$HEARTBEAT_URL/$APP/sync?success=$ok"   # APP: the same name as /ops/health's "app" >/dev/null || true
```

Node:

```js
export async function beat(job, error) {
  const { HEARTBEAT_URL: url, HEARTBEAT_TOKEN: token } = process.env;
  if (!url) return;
  const q = error ? `success=false&error=${encodeURIComponent(String(error).slice(0, 200))}` : "success=true";
  await fetch(`${url}/${APP}/${job}?${q}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => {});
}
```

Python:

```python
def beat(job: str, error: str | None = None) -> None:
    url, token = os.environ.get("HEARTBEAT_URL"), os.environ.get("HEARTBEAT_TOKEN")
    if not url:
        return
    q = f"success=false&error={quote(error[:200])}" if error else "success=true"
    try:
        urllib.request.urlopen(urllib.request.Request(f"{url}/{APP}/{job}?{q}", method="POST", headers={"Authorization": f"Bearer {token}"}), timeout=10)
    except Exception:
        pass
```
