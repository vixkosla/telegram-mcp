// Loaded only by the test subprocess: no real Telegram connection or credentials.
const { appendFileSync } = require("node:fs");
const Module = require("node:module");
const scenarios = JSON.parse(process.env.TEST_SCENARIOS);
let nextId = 0;
const user = { id: 123, firstName: "Test" };

class SignIn { constructor(args) { Object.assign(this, args); } }
class AuthorizationSignUpRequired {}
class StringSession {
  constructor(value) { this.value = value; }
  save() { return this.value || "test-session"; }
}
class TelegramClient {
  constructor(session) {
    this.session = session;
    this.id = nextId++;
    this.scenario = scenarios[this.id] || {};
    this.record("created");
  }
  record(event) {
    appendFileSync(process.env.TEST_EVENTS, JSON.stringify({ id: this.id, event }) + "\n");
  }
  fail(name) {
    if (this.scenario[name]) throw new Error(this.scenario[name]);
  }
  setLogLevel() {}
  async connect() {
    this.record("connect");
    this.fail("connectError");
    this.connected = true;
  }
  async disconnect() {
    this.record("disconnect");
    this.connected = false;
    this.fail("cleanupError");
  }
  async destroy() {
    this.record("destroy");
    await this.disconnect();
  }
  async checkAuthorization() {
    this.fail("authorizationError");
    return Boolean(this.scenario.authorized);
  }
  async sendCode() {
    this.record("sendCode");
    this.fail("sendCodeError");
    return { phoneCodeHash: "test-hash", isCodeViaApp: true };
  }
  async invoke(request) {
    this.record("signIn");
    if (!(request instanceof SignIn)) throw new Error("Unexpected RPC");
    if (request.phoneCode === "bad") throw new Error("PHONE_CODE_INVALID");
    if (request.phoneCode === "signup") return new AuthorizationSignUpRequired();
    if (request.phoneCode === "2fa") throw new Error("SESSION_PASSWORD_NEEDED");
    return { user };
  }
  async signInWithPassword(credentials, callbacks) {
    this.record("password");
    if (await callbacks.password() !== "correct") {
      await callbacks.onError(new Error("PASSWORD_HASH_INVALID"));
    }
    return user;
  }
  async getMe() { this.record("getMe"); return user; }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "telegram") return { TelegramClient, Api: { auth: { SignIn, AuthorizationSignUpRequired } } };
  if (request === "telegram/sessions") return { StringSession };
  if (request === "telegram/extensions/Logger") return { Logger: class {}, LogLevel: { NONE: 0 } };
  return originalLoad.call(this, request, parent, isMain);
};
