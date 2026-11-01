import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkApp, validateHealth, validateManifest } from "../lib/check.mjs";

const health = { app: "shop", version: "1", status: "warn", checks: [{ id: "db", level: "ok" }, { id: "stale", level: "warn", subject: "a", detail: "3 stale", data: { n: 3 } }] };
const manifest = {
  app: "shop",
  context: "Sells things. Every hour it pulls prices from the suppliers; a supplier answering 403 now and then is normal.",
  components: [
    { id: "api", kind: "service", depends_on: ["db"], checks: [{ id: "db" }] },
    { id: "db", kind: "store" },
    { id: "site", kind: "ui", url: "https://shop.example", probe: true, depends_on: ["api"] },
  ],
  tools: [{ name: "stale_products", description: "Products not updated in 24 h", params: { limit: { type: "number" } } }],
  actions: [
    { name: "disable_product", description: "Hide a product", risk: "medium", limit: "30/1d", rollback: "enable_product", dry_run: true, params: { id: { type: "uuid", required: true } } },
    { name: "enable_product", description: "Show it again", risk: "low", limit: "30/1d" },
  ],
};

/** A fake app: routes answer only with the token, unless `open`. */
function app(routes, open = false) {
  return async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (!open && init?.headers?.authorization !== "Bearer t") return new Response("", { status: 401 });
    if (!(path in routes)) return new Response("", { status: 404 });
    const body = routes[path];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  };
}

const has = (findings, want) => findings.some((f) => Object.entries(want).every(([k, v]) => f[k] === v));

describe("opstead check", () => {
  it("reaches level 4 for a complete app and finds nothing wrong", async () => {
    const r = await checkApp("https://shop.example/", { token: "t", fetch: app({ "/ops/health": health, "/ops/manifest": manifest, "/ops/metrics": "up 1\n" }) });
    assert.equal(r.level, 4);
    assert.equal(r.app, "shop");
    assert.deepEqual(r.findings.filter((f) => f.level === "error"), []);
  });

  it("stops at the first level with an error", async () => {
    const broken = { ...manifest, components: [{ id: "api", kind: "service", depends_on: ["nope"], checks: [{ id: "db" }] }] };
    const r = await checkApp("https://shop.example", { token: "t", fetch: app({ "/ops/health": health, "/ops/manifest": broken }) });
    assert.equal(r.level, 1);
    assert.ok(has(r.findings, { level: "error", where: "manifest.components[api].depends_on" }));
  });

  it("is level 0 when /ops/health does not answer, and says why", async () => {
    const r = await checkApp("https://shop.example", { fetch: app({}) });
    assert.equal(r.level, 0);
    assert.match(r.findings[0].message, /pass --token/);
  });

  it("calls routes that answer without the token an error", async () => {
    const r = await checkApp("https://shop.example", { token: "t", fetch: app({ "/ops/health": health }, true) });
    assert.ok(has(r.findings, { level: "error", where: "auth" }));
  });

  it("health: duplicate id + subject, bad level, missing detail", () => {
    const { findings } = validateHealth({ app: "x", checks: [{ id: "a", level: "bad" }, { id: "a", level: "bad" }, { id: "b", level: "red" }] });
    const got = findings.map((f) => `${f.level} ${f.where}`);
    for (const want of ["warn health.checks[a].detail", "error health.checks[a]", "error health.checks[b].level"]) assert.ok(got.includes(want), want);
  });

  it("actions: risk is required, rollback must exist, limit has a shape", () => {
    const { findings, errorsAt } = validateManifest({ actions: [{ name: "go", description: "d", rollback: "undo", limit: "often" }] }, new Set());
    assert.equal(errorsAt[4], true);
    const where = findings.map((f) => f.where);
    for (const want of ["manifest.actions[go].risk", "manifest.actions[go].rollback", "manifest.actions[go].limit"]) assert.ok(where.includes(want), want);
  });
});

describe("the spec's examples", () => {
  it("reach level 4 with no errors", async () => {
    const read = (p) => JSON.parse(readFileSync(new URL(`../../../spec/examples/${p}`, import.meta.url), "utf8"));
    const r = await checkApp("https://shop.example", { token: "t", fetch: app({ "/ops/health": read("health.json"), "/ops/manifest": read("manifest.json") }) });
    assert.deepEqual(r.findings.filter((f) => f.level === "error"), []);
    assert.equal(r.level, 4);
  });
});
