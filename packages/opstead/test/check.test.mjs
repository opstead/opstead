import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkApp, NEXT, validateHealth, validateManifest } from "../lib/check.mjs";

const health = { app: "shop", version: "1", status: "warn", checks: [{ id: "db", level: "ok" }, { id: "stale", level: "warn", subject: "a", detail: "3 stale", data: { n: 3 } }] };
const manifest = {
  app: "shop",
  context: "Sells things. Every hour it pulls prices from the suppliers; a supplier answering 403 now and then is normal.",
  components: [
    { id: "api", kind: "service", depends_on: ["db"], checks: [{ id: "db" }] },
    { id: "db", kind: "store" },
    { id: "site", kind: "ui", url: "https://shop.example", probe: true, depends_on: ["api"] },
  ],
  providers: [{ kind: "hosting", name: "self" }, { kind: "edge", name: "Cloudflare", serves: ["site"] }],
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

describe("0.1 details", () => {
  it("warns on a missing contract, launchd, a 401 without the token, and ids that are not snake_case", async () => {
    const m = { ...manifest, contract: undefined, components: [{ id: "owner-page", kind: "service", launchd: "x.y", checks: [{ id: "db" }] }], providers: [{ kind: "hosting", name: "self" }] };
    const unauth = (async (url, init) => (init?.headers?.authorization === "Bearer t" ? app({ "/ops/health": health, "/ops/manifest": m })(url, init) : new Response("", { status: 401 })));
    const r = await checkApp("https://shop.example", { token: "t", fetch: unauth });
    for (const where of ["manifest.contract", "manifest.components[owner-page].id", "manifest.components[owner-page].launchd", "auth"]) assert.ok(has(r.findings, { level: "warn", where }), where);
    assert.equal(r.level, 4);
  });
});

describe("speed", () => {
  it("checks declared operations and fetches /ops/runs", async () => {
    const { findings, errorsAt } = validateManifest({ operations: [{ name: "search", steps: ["calendar"] }] }, new Set());
    assert.equal(errorsAt[3], true);
    assert.ok(has(findings, { level: "error", where: "manifest.operations[search].steps" }));
    const m = { ...manifest, operations: [{ name: "search", unit: "combinations", steps: [{ name: "calendar", unit: "stays" }] }] };
    const missing = await checkApp("https://shop.example", { token: "t", fetch: app({ "/ops/health": health, "/ops/manifest": m }) });
    assert.ok(has(missing.findings, { level: "error", where: "runs" }));
    assert.equal(missing.level, 2);
    const runs = { runs: [{ operation: "search", at: "2026-11-01T12:00:00Z", units: 88, s: 313, ok: true, steps: [{ name: "calendar", units: 8, s: 98 }] }] };
    const fine = await checkApp("https://shop.example", { token: "t", fetch: app({ "/ops/health": health, "/ops/manifest": m, "/ops/runs": runs }) });
    assert.equal(fine.level, 4);
  });
});

describe("the spec's examples", () => {
  it("reach level 4 with no errors", async () => {
    const read = (p) => JSON.parse(readFileSync(new URL(`../../../spec/examples/${p}`, import.meta.url), "utf8"));
    const r = await checkApp("https://shop.example", { token: "t", fetch: app({ "/ops/health": read("health.json"), "/ops/manifest": read("manifest.json"), "/ops/runs": read("runs.json") }) });
    assert.deepEqual(r.findings.filter((f) => f.level === "error"), []);
    assert.equal(r.level, 4);
  });
});

describe("providers", () => {
  const fetchWith = (m) => app({ "/ops/health": health, "/ops/manifest": m });

  it("level 2 needs a hosting provider, and the report says so", async () => {
    const r = await checkApp("https://shop.example", { token: "t", fetch: fetchWith({ ...manifest, providers: [{ kind: "edge", name: "Cloudflare" }] }) });
    assert.equal(r.level, 1);
    assert.ok(has(r.findings, { level: "error", where: "manifest.providers" }));
    assert.match(r.next, /hosting provider/);
    const none = await checkApp("https://shop.example", { token: "t", fetch: fetchWith({ ...manifest, providers: undefined }) });
    assert.equal(none.level, 1);
    assert.match(none.findings.find((f) => f.where === "manifest.providers").message, /no hosting provider/);
  });

  it("names unknown kinds, empty names, bad serves ids and status urls", () => {
    const comps = [{ id: "site", kind: "ui", url: "https://x.example", probe: true }];
    const providers = [
      { kind: "hosting", name: "IONOS", serves: ["site", "nope"] },
      { kind: "cdn", name: "Cloudflare" },
      { kind: "mail", name: " " },
      { kind: "dns", name: "IONOS", serves: "site" },
      { kind: "storage", name: "Bucketco", status_url: "status.bucketco.example" },
    ];
    const { findings, errorsAt, has: got } = validateManifest({ components: comps, providers }, new Set());
    assert.equal(errorsAt[2], true);
    assert.equal(got.hosting, false);
    const where = findings.filter((f) => f.level === "error").map((f) => f.where);
    for (const want of ["manifest.providers[hosting · IONOS].serves", "manifest.providers[cdn · Cloudflare].kind", "manifest.providers[mail].name", "manifest.providers[dns · IONOS].serves", "manifest.providers[storage · Bucketco].status_url"]) assert.ok(where.includes(want), want);
    assert.match(findings.find((f) => f.where === "manifest.providers[hosting · IONOS].serves").message, /"nope" is not a component id/);
    // An invalid hosting entry is reported once, not again as missing.
    assert.ok(!where.includes("manifest.providers"));
  });

  it("accepts the fields ops reads, with serves omitted meaning every part", () => {
    const providers = [
      { kind: "hosting", name: "IONOS", what: "shared hosting: Apache, PHP, MySQL" },
      { kind: "mail", name: "IONOS", serves: ["site"] },
      { kind: "edge", name: "Cloudflare" },
      { kind: "registrar", name: "Namegood", status_url: "https://status.namegood.example/api/v2/status.json" },
    ];
    const { findings, errorsAt, has: got } = validateManifest({ components: [{ id: "site", kind: "ui", url: "https://x.example", probe: true }], providers }, new Set());
    assert.equal(errorsAt[2], false, JSON.stringify(findings));
    assert.equal(got.hosting, true);
  });

  it("must be an array; the next step for level 1 mentions it", () => {
    assert.equal(validateManifest({ components: manifest.components, providers: { kind: "hosting" } }, new Set()).errorsAt[2], true);
    assert.match(NEXT[1], /providers/);
  });
});

describe("tech", () => {
  const fetchWith = (m) => app({ "/ops/health": health, "/ops/manifest": m });
  const withTech = (db, api) => ({ ...manifest, components: [{ ...manifest.components[0], tech: api }, { ...manifest.components[1], tech: db }, manifest.components[2]] });

  it("counts the parts that declare it, and is optional", async () => {
    const r = await checkApp("https://shop.example", { token: "t", fetch: fetchWith(withTech([{ name: "MySQL", version: "5.7.44" }], [{ name: "PHP", version: "8.4" }, { name: "Apache" }])) });
    assert.equal(r.level, 4);
    assert.equal(r.tech, 2);
    assert.ok(has(r.findings, { level: "ok", where: "manifest.components", message: "2 of 3 parts declare what they run (tech)" }));
    const none = await checkApp("https://shop.example", { token: "t", fetch: fetchWith(manifest) });
    assert.equal(none.tech, 0);
    assert.equal(none.level, 4);
  });

  it("a malformed entry warns and costs no level", async () => {
    for (const [db, where] of [
      [{ name: "MySQL" }, "manifest.components[db].tech"],
      [[{ version: "5.7" }], "manifest.components[db].tech[0]"],
      [[{ name: " " }], "manifest.components[db].tech[0]"],
      [["MySQL"], "manifest.components[db].tech[0]"],
      [[{ name: "MySQL", version: 5.7 }], "manifest.components[db].tech[MySQL].version"],
    ]) {
      const r = await checkApp("https://shop.example", { token: "t", fetch: fetchWith(withTech(db, undefined)) });
      assert.equal(r.level, 4, JSON.stringify(db));
      assert.equal(r.tech, 0, JSON.stringify(db));
      assert.ok(has(r.findings, { level: "warn", where }), `${JSON.stringify(db)}: ${JSON.stringify(r.findings)}`);
    }
  });

  it("the spec's example declares it", () => {
    const m = JSON.parse(readFileSync(new URL("../../../spec/examples/manifest.json", import.meta.url), "utf8"));
    assert.equal(validateManifest(m, new Set()).has.tech, 2);
  });
});
