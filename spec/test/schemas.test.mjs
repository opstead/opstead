// The examples must pass the schemas, and the usual mistakes must not.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = Object.fromEntries(["health", "manifest", "action-reply"].map((n) => [n, ajv.compile(read(`schema/${n}.schema.json`))]));
const valid = (s, body) => {
  const ok = schema[s](body);
  return ok ? true : JSON.stringify(schema[s].errors);
};

it("the examples pass", () => {
  for (const [s, e] of [["health", "health"], ["manifest", "manifest"], ["action-reply", "action-done"], ["action-reply", "action-dry-run"], ["action-reply", "action-refused"]]) {
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
  assert.notEqual(valid("action-reply", { error: "x", result: "y" }), true, "an error that also claims a result");
});
