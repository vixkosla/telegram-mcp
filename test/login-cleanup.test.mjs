import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

function server(t, { scenarios = [], pending = true, session = false, block } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "telegram-mcp-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(new URL("../server.mjs", import.meta.url), join(dir, "server.mjs"));
  if (pending) writeFileSync(join(dir, "pending.json"), JSON.stringify({
    phone: "+15555550123", phoneCodeHash: "test-hash", session: "test-session",
    createdAt: new Date().toISOString(), ...(typeof pending === "object" ? pending : {}),
  }));
  if (session) writeFileSync(join(dir, "session.txt"), "test-session");
  if (block) {
    rmSync(join(dir, block), { force: true });
    mkdirSync(join(dir, block));
  }
  const child = spawn(process.execPath, [
    "--require", fileURLToPath(new URL("./fixtures/telegram.cjs", import.meta.url)), join(dir, "server.mjs"),
  ], {
    env: {
      ...process.env, NODE_OPTIONS: "", TELEGRAM_MCP_CONFIG: join(dir, "config.json"),
      TELEGRAM_API_ID: "123", TELEGRAM_API_HASH: "a".repeat(32),
      TEST_SCENARIOS: JSON.stringify(scenarios), TEST_EVENTS: join(dir, "events.jsonl"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  let id = 0;
  const waiting = new Map();
  lines.on("line", line => {
    const response = JSON.parse(line);
    const request = waiting.get(response.id);
    if (request) { waiting.delete(response.id); request.resolve(response.result); }
  });
  child.on("exit", () => {
    for (const request of waiting.values()) request.reject(new Error(`Server exited: ${stderr}`));
    waiting.clear();
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    lines.close();
  });
  return {
    dir,
    events: () => existsSync(join(dir, "events.jsonl"))
      ? readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)) : [],
    call: (name, args = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      waiting.set(requestId, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } }) + "\n");
    }),
    close: async () => { child.stdin.end(); assert.deepEqual(await exited, [0, null], stderr); },
  };
}

function disposed(app, id = 0) {
  const events = app.events().filter(event => event.id === id).map(event => event.event);
  assert.equal(events.filter(event => event === "destroy").length, 1, JSON.stringify(events));
  assert.equal(events.filter(event => event === "disconnect").length, 1, JSON.stringify(events));
}
function errorIs(result, pattern) {
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, pattern);
}
function value(result) {
  assert.notEqual(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const failures = [
  ["invalid code", {}, { code: "bad" }, /PHONE_CODE_INVALID/],
  ["incorrect inline password", {}, { code: "2fa", password: "wrong" }, /PASSWORD_HASH_INVALID/],
  ["incorrect pending password", { pending: { needsPassword: true } }, { password: "wrong" }, /PASSWORD_HASH_INVALID/],
  ["signup required", {}, { code: "signup" }, /не зарегистрирован/],
  ["partially failed connection", { scenarios: [{ connectError: "CONNECT_FAILED" }] }, { code: "ok" }, /CONNECT_FAILED/],
  ["session write failure", { block: "session.txt" }, { code: "ok" }, /EISDIR/],
  ["cleanup failure preserves login error", { scenarios: [{ cleanupError: "CLEANUP_FAILED" }] }, { code: "bad" }, /PHONE_CODE_INVALID/],
];
for (const [name, options, args, expected] of failures) {
  test(`login_sign_in: ${name}`, { timeout: 5000 }, async t => {
    const app = server(t, options);
    errorIs(await app.call("login_sign_in", args), expected);
    disposed(app);
    assert.equal(existsSync(join(app.dir, "pending.json")), true);
  });
}

for (const [name, options, expected] of [
  ["sendCode failure", { scenarios: [{ sendCodeError: "SEND_CODE_FAILED" }] }, /SEND_CODE_FAILED/],
  ["authorization check failure", { scenarios: [{ authorizationError: "AUTH_CHECK_FAILED" }] }, /AUTH_CHECK_FAILED/],
  ["unexpected authorization", { scenarios: [{ authorized: true }] }, /уже авторизована/],
  ["partially failed connection", { scenarios: [{ connectError: "CONNECT_FAILED" }] }, /CONNECT_FAILED/],
  ["pending write failure", { block: "pending.json" }, /EISDIR/],
  ["cleanup failure preserves sendCode error", { scenarios: [{ sendCodeError: "SEND_CODE_FAILED", cleanupError: "CLEANUP_FAILED" }] }, /SEND_CODE_FAILED/],
]) {
  test(`login_send_code: ${name}`, { timeout: 5000 }, async t => {
    const app = server(t, { pending: false, ...options });
    errorIs(await app.call("login_send_code", { phone: "+15555550123" }), expected);
    disposed(app);
  });
}

test("login_send_code saves pending state and disposes the temporary client", { timeout: 5000 }, async t => {
  const app = server(t, { pending: false });
  assert.equal(value(await app.call("login_send_code", { phone: "+15555550123" })).sent, true);
  assert.equal(JSON.parse(readFileSync(join(app.dir, "pending.json"))).session, "test-session");
  disposed(app);
});

test("2FA prompts dispose clients and preserve a retryable pending session", { timeout: 5000 }, async t => {
  const app = server(t);
  assert.equal(value(await app.call("login_sign_in", { code: "2fa" })).needsPassword, true);
  disposed(app, 0);
  assert.equal(JSON.parse(readFileSync(join(app.dir, "pending.json"))).needsPassword, true);
  assert.equal(value(await app.call("login_sign_in")).needsPassword, true);
  disposed(app, 1);
  assert.equal(value(await app.call("login_sign_in", { password: "correct" })).authorized, true);
  assert.equal(app.events().some(event => event.id === 2 && event.event === "destroy"), false);
});

for (const args of [{ code: "ok" }, { code: "2fa", password: "correct" }]) {
  test(`successful sign-in retains the cached client (${args.code})`, { timeout: 5000 }, async t => {
    const app = server(t);
    assert.equal(value(await app.call("login_sign_in", args)).authorized, true);
    assert.equal(readFileSync(join(app.dir, "session.txt"), "utf8"), "test-session");
    assert.equal(existsSync(join(app.dir, "pending.json")), false);
    assert.equal(value(await app.call("status")).authorized, true);
    assert.equal(app.events().filter(event => event.event === "created").length, 1);
    assert.equal(app.events().some(event => event.event === "destroy" || event.event === "disconnect"), false);
    await app.close();
    disposed(app);
  });
}

test("repeated invalid codes do not accumulate clients and allow a successful retry", { timeout: 5000 }, async t => {
  const app = server(t);
  for (let i = 0; i < 3; i++) {
    errorIs(await app.call("login_sign_in", { code: "bad" }), /PHONE_CODE_INVALID/);
    disposed(app, i);
  }
  assert.equal(value(await app.call("login_sign_in", { code: "ok" })).authorized, true);
  assert.equal(app.events().filter(event => event.event === "destroy").length, 3);
});

test("incorrect inline password can be retried without resubmitting the consumed code", { timeout: 5000 }, async t => {
  const app = server(t);
  errorIs(await app.call("login_sign_in", { code: "2fa", password: "wrong" }), /PASSWORD_HASH_INVALID/);
  disposed(app, 0);
  assert.equal(JSON.parse(readFileSync(join(app.dir, "pending.json"))).needsPassword, true);
  assert.equal(value(await app.call("login_sign_in", { password: "correct" })).authorized, true);
  assert.equal(app.events().filter(event => event.event === "signIn").length, 1);
});

for (const scenario of [{ connectError: "CONNECT_FAILED" }, { authorizationError: "AUTH_CHECK_FAILED" }, {}]) {
  test(`saved-session failure is cleaned up: ${JSON.stringify(scenario)}`, { timeout: 5000 }, async t => {
    const app = server(t, { session: true, scenarios: [scenario, scenario] });
    for (let i = 0; i < 2; i++) {
      assert.equal(value(await app.call("status")).authorized, false);
      disposed(app, i);
    }
  });
}
