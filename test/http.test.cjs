const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../src/server.cjs");
const { create, message, analyze, approve } = require("./helpers.cjs");
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slushd-http-"));
  const app = await createApp({ dataDir: dir });
  const base = await app.listen();
  t.after(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const post = async (p, value) => {
    const res = await fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    return { status: res.status, body: await res.json() };
  };
  return { app, base, post };
}
async function start(c) {
  let { body: s } = await c.post("/intakes", create());
  ({ body: s } = await c.post(`/intakes/${s.intakeId}/messages`, message(s)));
  const { body: a } = await c.post("/analyze", analyze(s));
  await c.app.orchestrator.idle();
  return a;
}
test("HTTP happy path, snapshot, live SSE, disconnect and replay cursors", async (t) => {
  const c = await setup(t);
  const a = await start(c);
  const snapshot = await (await fetch(c.base + a.links.snapshot)).json();
  assert.equal(snapshot.status, "awaiting_approval");
  const ctrl = new AbortController();
  const live = await fetch(
    c.base + a.links.events + "?after=" + snapshot.lastSequence,
    { signal: ctrl.signal },
  );
  assert.match(live.headers.get("content-type"), /event-stream/);
  const reader = live.body.getReader();
  const pending = reader.read();
  const approved = await c.post(a.links.snapshot + "/approval", approve());
  assert.equal(approved.status, 200);
  assert((await pending).value.length);
  ctrl.abort();
  await c.app.orchestrator.idle();
  const r = c.app.orchestrator.get(a.runId);
  assert.equal(r.snapshot.status, "completed");
  const replay = await (
    await fetch(c.base + a.links.events + "?after=0", {
      headers: { "Last-Event-ID": String(snapshot.lastSequence) },
    })
  ).text();
  const events = replay
    .trim()
    .split("\n\n")
    .map((f) =>
      JSON.parse(
        f
          .split("\n")
          .find((x) => x.startsWith("data:"))
          .slice(6),
      ),
    );
  assert.equal(events[0].sequence, snapshot.lastSequence + 1);
  assert.equal(events.at(-1).type, "run.finished");
  assert.equal(new Set(events.map((e) => e.sequence)).size, events.length);
  assert.equal(
    (await fetch(c.base + a.links.events + "?after=" + r.snapshot.lastSequence))
      .status,
    204,
  );
  for (const after of ["-1", "1.2", "9999", "01"])
    assert.equal(
      (await fetch(c.base + a.links.events + "?after=" + after)).status,
      400,
    );
});
test("HTTP validation, CORS and JSON limit", async (t) => {
  const c = await setup(t);
  assert.equal((await c.post("/intakes", { bad: true })).status, 400);
  assert.equal(
    (await c.post("/intakes", { ...create(), message: "x".repeat(20000) }))
      .status,
    413,
  );
  const bad = await fetch(c.base + "/intakes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(bad.status, 400);
  const cors = await fetch(c.base + "/health", {
    headers: { Origin: "http://localhost:5173" },
  });
  assert.equal(
    cors.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  assert.equal(
    (
      await fetch(c.base + "/health", {
        headers: { Origin: "https://unknown.example" },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(c.base + "/analyses/invalid")).status, 404);
});

test("playground assets and same-origin form requests use the real intake API", async (t) => {
  const c = await setup(t);
  const page = await fetch(c.base + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(await page.text(), /id="prompt-form"/);
  for (const asset of ["/ui.js", "/ui.css"]) {
    const response = await fetch(c.base + asset);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  const response = await fetch(c.base + "/intakes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: c.base },
    body: JSON.stringify(create()),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).status, "needs_input");
  assert.equal((await fetch(c.base + "/api")).status, 200);
  assert.equal((await fetch(c.base + "/missing.js")).status, 404);
});
