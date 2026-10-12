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
test("chat returns a cleaned campaign profile and gates generate on required fields", async (t) => {
  const c = await setup(t);
  const outputs = [
    {
      reply: "Bütçeniz nedir?",
      profile: {
        name: " Yakalıyo ",
        productName: null,
        description: "NFC sadakat programı",
        audience: null,
        region: "Türkiye",
        topic: null,
        url: "javascript:alert(1)",
        budget: -5,
        currency: "try",
        unitContribution: null,
      },
      generate: true,
    },
    { reply: "Üretiyorum.", generate: true },
  ];
  let seen;
  const chat = new CliChat(c.store, {
    runner: async (args) => {
      seen = args.text;
      return outputs.shift();
    },
  });
  const a = await chat.send(request());
  assert.equal(a.profile.name, "Yakalıyo");
  assert.equal(a.profile.url, null);
  assert.equal(a.profile.budget, null);
  assert.equal(a.profile.currency, "TRY");
  assert.deepEqual(a.missing, ["audience"]);
  assert.equal(a.generate, false);
  // A runner without profile output keeps the client's current profile.
  const b = await chat.send({
    ...request(),
    profile: { ...a.profile, audience: "Kafe sahipleri" },
  });
  assert.match(seen, /Kafe sahipleri/);
  assert.equal(b.ready, true);
  assert.equal(b.generate, true);
});
