import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { connect, setEnv } from "../lib/connect.mjs";

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
    assert.deepEqual(r, { name: "shop.example", app_url: "http://127.0.0.1:3000", written: ["OPS_TOKEN", "HEARTBEAT_URL", "HEARTBEAT_TOKEN"] });
    assert.equal(readFileSync(env, "utf8"), "PORT=3000\nOPS_TOKEN=s3cret\nHEARTBEAT_URL=https://hook.example\nHEARTBEAT_TOKEN=hb\n");
    const fresh = join(dir, "new.env");
    await connect("https://hook.example/enrol/abcdefghijklmnopqrstuv", { env: fresh, fetch: fake });
    assert.equal(statSync(fresh).mode & 0o777, 0o600);
  });

  it("says when a code is used or old", async () => {
    await assert.rejects(connect("https://hook.example/enrol/abcdefghijklmnopqrstuv", { env: "/nonexistent/.env", fetch: async () => new Response("", { status: 404 }) }), /used already/);
    await assert.rejects(connect("https://hook.example/other", { env: ".env" }), /not an enrolment link/);
  });
});
