const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { CliChat } = require("../src/runtime/chat.cjs");
const { AppError } = require("../src/runtime/core.cjs");
const { setup } = require("./helpers.cjs");
const request = () => ({
  schemaVersion: "4.0.0",
  clientRequestId: randomUUID(),
  message: "Merhaba",
});
test("live chat saves reply and duplicate requests do not run CLI again", async (t) => {
  const c = await setup(t);
  let calls = 0;
  const chat = new CliChat(c.store, {
    runner: async () => {
      calls++;
      return { reply: "Merhaba!" };
    },
  });
  const req = request();
  const [a, b] = await Promise.all([chat.send(req), chat.send(req)]);
  assert.deepEqual(a, b);
  assert.equal(a.origin, "live");
  assert.equal(calls, 1);
  assert.deepEqual(await chat.send(req), a);
  await assert.rejects(chat.send({ ...req, message: "Başka" }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
});
test("CLI failure is visible and never replaced with demo output", async (t) => {
  const c = await setup(t);
  const chat = new CliChat(c.store, {
    runner: async () => {
      throw new AppError("BUSY", "CLI limit", 429, true);
    },
  });
  await assert.rejects(chat.send(request()), { code: "BUSY" });
  assert.equal((await c.store.list("cli-chat")).length, 0);
  await assert.rejects(chat.send({ ...request(), message: " " }), {
    code: "INVALID_REQUEST",
  });
});
test("different prompts cannot start concurrent CLI processes", async (t) => {
  const c = await setup(t);
  let release;
  const chat = new CliChat(c.store, {
    runner: () => new Promise((r) => (release = r)),
  });
  const first = chat.send(request());
  while (!release) await new Promise((r) => setImmediate(r));
  await assert.rejects(chat.send(request()), { code: "BUSY" });
  release({ reply: "Tamam" });
  await first;
});
