import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { connect, getEnv, setCiSecrets, setEnv } from "../lib/connect.mjs";

describe("connect", () => {
  it("sets names in an env file in place and appends new ones", () => {
    assert.equal(setEnv("PORT=1\nOPS_TOKEN=old\n", { OPS_TOKEN: "new", HEARTBEAT_URL: "h" }), "PORT=1\nOPS_TOKEN=new\nHEARTBEAT_URL=h\n");
    assert.equal(setEnv("", { A: "1" }), "A=1\n");
    assert.equal(setEnv("export A=1", { A: "2" }), "A=2\n");
  });

  it("trades the code for the token and writes it without returning it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opstead-"));
    const env = join(dir, ".env");
    writeFileSync(env, "PORT=3000\n");
    let asked = "";
    const fake = async (url) => {
      asked = String(url);
      return Response.json({ name: "shop.example", token: "s3cret", app_url: "http://127.0.0.1:3000", heartbeat_url: "https://hook.example", heartbeat_token: "hb" });
    };
    const r = await connect("https://hook.example/enrol/abcdefghijklmnopqrstuv", { env, appUrl: "http://127.0.0.1:3000", fetch: fake });
    assert.equal(asked, "https://hook.example/enrol/abcdefghijklmnopqrstuv?url=http%3A%2F%2F127.0.0.1%3A3000");
    assert.deepEqual(r, { name: "shop.example", app_url: "http://127.0.0.1:3000", written: ["OPS_TOKEN", "HEARTBEAT_URL", "HEARTBEAT_TOKEN"], deploy: false });
    assert.equal(readFileSync(env, "utf8"), "PORT=3000\nOPS_TOKEN=s3cret\nHEARTBEAT_URL=https://hook.example\nHEARTBEAT_TOKEN=hb\n");
    const fresh = join(dir, "new.env");
    await connect("https://hook.example/enrol/abcdefghijklmnopqrstuv", { env: fresh, fetch: fake });
    assert.equal(statSync(fresh).mode & 0o777, 0o600);
  });

  it("says when a code is used or old", async () => {
    await assert.rejects(connect("https://hook.example/enrol/abcdefghijklmnopqrstuv", { env: "/nonexistent/.env", fetch: async () => new Response("", { status: 404 }) }), /used already/);
    await assert.rejects(connect("https://hook.example/other", { env: ".env" }), /not an enrolment link/);
  });

  it("reads names from an env file", () => {
    assert.equal(getEnv("A=1\nexport B='two'\nB=\"3\"\n", "B"), "3");
    assert.equal(getEnv("A=\n", "A"), undefined);
    assert.equal(getEnv("AB=1\n", "A"), undefined);
  });
});

describe("deploy token", () => {
  const reply = { name: "shop", token: "s3cret", app_url: null, deploy_token: "d3ploy", deploy_url: "https://hook.example/deploy" };
  const link = "https://hook.example/enrol/abcdefghijklmnopqrstuv";

  it("writes OPS_DEPLOY_TOKEN and OPS_DEPLOY_URL from the enrolment reply", async () => {
    const env = join(mkdtempSync(join(tmpdir(), "opstead-")), ".env");
    const r = await connect(link, { env, fetch: async () => Response.json(reply) });
    assert.equal(r.deploy, true);
    assert.deepEqual(r.written, ["OPS_TOKEN", "OPS_DEPLOY_TOKEN", "OPS_DEPLOY_URL"]);
    assert.ok(!JSON.stringify(r).includes("d3ploy"), "the token is never returned");
    assert.equal(readFileSync(env, "utf8"), "OPS_TOKEN=s3cret\nOPS_DEPLOY_TOKEN=d3ploy\nOPS_DEPLOY_URL=https://hook.example/deploy\n");
  });

  it("goes on without one when the operator is older", async () => {
    const env = join(mkdtempSync(join(tmpdir(), "opstead-")), ".env");
    for (const older of [{ name: "shop", token: "s3cret", app_url: null }, { ...reply, deploy_url: "not a url" }, { ...reply, deploy_token: "" }]) {
      const r = await connect(link, { env, fetch: async () => Response.json(older) });
      assert.equal(r.deploy, false);
      assert.deepEqual(r.written, ["OPS_TOKEN"]);
    }
  });

  it("sets the CI secrets through gh's standard input, never as an argument", () => {
    const env = join(mkdtempSync(join(tmpdir(), "opstead-")), ".env");
    writeFileSync(env, "OPS_TOKEN=s3cret\nOPS_DEPLOY_TOKEN=d3ploy\nOPS_DEPLOY_URL=https://hook.example/deploy\n");
    const calls = [];
    const run = (cmd, args, input) => (calls.push({ cmd, args, input }), { status: 0, stderr: "" });
    assert.deepEqual(setCiSecrets({ env, ci: "github", repo: "owner/shop", run }), ["OPS_DEPLOY_TOKEN", "OPS_DEPLOY_URL"]);
    assert.deepEqual(calls, [
      { cmd: "gh", args: ["secret", "set", "OPS_DEPLOY_TOKEN", "--repo", "owner/shop"], input: "d3ploy" },
      { cmd: "gh", args: ["secret", "set", "OPS_DEPLOY_URL", "--repo", "owner/shop"], input: "https://hook.example/deploy" },
    ]);
    assert.ok(!calls.some((c) => c.args.join(" ").includes("s3cret")), "OPS_TOKEN never goes to CI");
    calls.length = 0;
    setCiSecrets({ env, ci: "github", run });
    assert.deepEqual(calls[0].args, ["secret", "set", "OPS_DEPLOY_TOKEN"]);
  });

  it("says what went wrong without the values", () => {
    const dir = mkdtempSync(join(tmpdir(), "opstead-"));
    const env = join(dir, ".env");
    writeFileSync(env, "OPS_TOKEN=s3cret\n");
    assert.throws(() => setCiSecrets({ env, ci: "github", run: () => assert.fail("must not run") }), /no OPS_DEPLOY_TOKEN or OPS_DEPLOY_URL/);
    assert.throws(() => setCiSecrets({ env, ci: "gitlab" }), /only github/);
    writeFileSync(env, "OPS_DEPLOY_TOKEN=d3ploy\nOPS_DEPLOY_URL=https://hook.example/deploy\n");
    const enoent = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    assert.throws(() => setCiSecrets({ env, ci: "github", run: () => ({ status: null, stderr: "", error: enoent }) }), /not installed/);
    let n = 0;
    const second = () => (++n === 1 ? { status: 0, stderr: "" } : { status: 1, stderr: "HTTP 403: Resource not accessible\n" });
    assert.throws(() => setCiSecrets({ env, ci: "github", run: second }), (e) => /OPS_DEPLOY_URL failed \(OPS_DEPLOY_TOKEN set\): HTTP 403/.test(e.message) && !e.message.includes("d3ploy"));
  });
});
