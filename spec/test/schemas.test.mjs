// The examples must pass the schemas, and the usual mistakes must not.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = Object.fromEntries(["health", "manifest", "action-reply", "runs", "deploy"].map((n) => [n, ajv.compile(read(`schema/${n}.schema.json`))]));
const valid = (s, body) => {
  const ok = schema[s](body);
  return ok ? true : JSON.stringify(schema[s].errors);
};

it("the examples pass", () => {
  for (const [s, e] of [["health", "health"], ["manifest", "manifest"], ["action-reply", "action-done"], ["action-reply", "action-dry-run"], ["action-reply", "action-refused"], ["runs", "runs"], ["deploy", "deploy"]]) {
    assert.equal(valid(s, read(`examples/${e}.json`)), true, e);
  }
});

it("the usual mistakes fail", () => {
  assert.notEqual(valid("health", { checks: [{ id: "x", level: "bad" }] }), true, "a bad check without detail");
  assert.notEqual(valid("health", { checks: [{ id: "Bad-Id", level: "ok" }] }), true, "an id that is not snake_case");
  assert.notEqual(valid("health", { status: "red", checks: [] }), true, "an unknown level");
  assert.notEqual(valid("manifest", { actions: [{ name: "go", description: "d" }] }), true, "an action without risk");
  assert.notEqual(valid("manifest", { actions: [{ name: "go", description: "d", risk: "low", limit: "often" }] }), true, "a limit without a shape");
  assert.notEqual(valid("manifest", { components: [{ id: "s", kind: "ui", probe: true }] }), true, "a probe without a url");
  assert.notEqual(valid("manifest", { components: [{ id: "s", kind: "server" }] }), true, "an unknown kind");
  assert.notEqual(valid("manifest", { providers: [{ kind: "cdn", name: "Cloudflare" }] }), true, "an unknown provider kind");
  assert.notEqual(valid("manifest", { providers: [{ kind: "hosting", name: "" }] }), true, "a provider without a name");
  assert.notEqual(valid("manifest", { components: [{ id: "db", kind: "store", tech: { name: "MySQL" } }] }), true, "tech that is not a list");
  assert.notEqual(valid("manifest", { components: [{ id: "db", kind: "store", tech: [{ name: "" }] }] }), true, "tech without a name");
  assert.notEqual(valid("manifest", { components: [{ id: "db", kind: "store", tech: [{ name: "MySQL", version: 5.7 }] }] }), true, "a version as a number");
  assert.notEqual(valid("health", { commit: "main", checks: [] }), true, "a commit that is a branch name");
  assert.notEqual(valid("health", { deployed_at: "yesterday", checks: [] }), true, "deployed_at that is not a time");
  assert.notEqual(valid("manifest", { source: { repo: "https://x:ghp_abc@github.com/o/r" } }), true, "a credential in the repo URL");
  assert.notEqual(valid("manifest", { source: { repo: "https://gitlab.example/o/r?private_token=abc" } }), true, "a token in the query");
  assert.notEqual(valid("manifest", { source: { repo: "git@github.com:o/r.git" } }), true, "an ssh address");
  assert.notEqual(valid("manifest", { source: { repo: "https://github.com/o/r", path: "../other" } }), true, "a path out of the repo");
  assert.notEqual(valid("manifest", { source: { path: "backend" } }), true, "a source without a repo");
  assert.notEqual(valid("deploy", { app: "shop", status: "deployed" }), true, "an unknown deploy status");
  assert.notEqual(valid("deploy", { status: "started" }), true, "a deploy event without its app");
  assert.notEqual(valid("action-reply", { error: "x", result: "y" }), true, "an error that also claims a result");
  assert.notEqual(valid("runs", { runs: [{ operation: "search", at: "2026-11-01T12:00:00Z", units: "88", s: 3, ok: true }] }), true, "units as a string");
});
