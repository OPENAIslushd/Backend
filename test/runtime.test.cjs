const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  setup,
  create,
  message,
  analyze,
  approve,
  ready,
  waiting,
  complete,
} = require("./helpers.cjs");
const { schema, AppError, checks } = require("../src/runtime/core.cjs");
const { Orchestrator } = require("../src/orchestrator/service.cjs");
const { IntakeService } = require("../src/intake/service.cjs");
const fixture = require("../contracts/examples/analyze.demo.response.json");
test("chat → research → explicit approval → strategy → simulator → JSON record → result", async (t) => {
  const c = await setup(t);
  const r = await complete(c);
  assert.equal(r.snapshot.status, "completed");
  checks.checkEvents(r.events);
  schema("Response", r.snapshot.result);
  const record = await c.store.read(`memory/demo/${r.snapshot.runId}.json`);
  schema("MemoryRecord", record);
  assert.deepEqual(record.analysis.approval, r.snapshot.approval);
  assert.deepEqual(record.analysis.testResults, r.snapshot.result.testResults);
  assert.equal(r.events.at(-1).type, "run.finished");
  assert.equal(
    r.events.filter(
      (e) =>
        e.type === "step.started" && e.payload.step.stepId === "strategy.build",
    ).length,
    1,
  );
});
test("missing questions, no invented fields, incomplete consent is separate from approval", async (t) => {
  let calls = 0;
  const c = await setup(t, {
    strategy: async () => {
      calls++;
      return fixture.buildSuggestion;
    },
  });
  const s = await c.intakes.create(create());
  assert.equal(s.status, "needs_input");
  assert.equal(s.product.pricing.value, null);
  assert(s.questions.every((q) => q.reason.length));
  await assert.rejects(c.orchestrator.analyze(analyze(s)), {
    code: "INTAKE_NOT_READY",
  });
  const next = await c.intakes.message(s.intakeId, message(s));
  const accepted = await c.orchestrator.analyze(analyze(next));
  await c.orchestrator.idle();
  assert.equal(
    c.orchestrator.get(accepted.runId).snapshot.status,
    "awaiting_approval",
  );
  assert.equal(calls, 0);
  assert.equal(c.orchestrator.active, null);
});
test("insufficient description never starts research, even with consent", async (t) => {
  const c = await setup(t);
  const s = await c.intakes.create({ ...create(), message: "merhaba" });
  const next = await c.intakes.message(s.intakeId, message(s));
  assert.equal(next.status, "needs_input");
  assert(next.questions.find((q) => q.field === "productDescription").blocking);
  await assert.rejects(c.orchestrator.analyze(analyze(next)), {
    code: "INTAKE_NOT_READY",
  });
});
test("create, message and analyze retries; conflicts and concurrent revisions", async (t) => {
  const c = await setup(t);
  const req = create();
  const s = await c.intakes.create(req);
  assert.deepEqual(await c.intakes.create(req), s);
  await assert.rejects(c.intakes.create({ ...req, message: "different" }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  const m = message(s);
  const next = await c.intakes.message(s.intakeId, m);
  assert.deepEqual(await c.intakes.message(s.intakeId, m), next);
  await assert.rejects(c.intakes.message(s.intakeId, message(s)), {
    code: "REVISION_CONFLICT",
  });
  const req2 = analyze(next);
  const [a, b] = await Promise.all([
    c.orchestrator.analyze(req2),
    c.orchestrator.analyze(req2),
  ]);
  assert.equal(a.runId, b.runId);
  await c.orchestrator.idle();
  assert.equal(c.orchestrator.runs.size, 1);
});
test("labelled updates preserve other fields, null unknowns and reset consent", async (t) => {
  const c = await setup(t);
  const s = await ready(c);
  const next = await c.intakes.message(
    s.intakeId,
    message(
      s,
      "reply",
      "Hedef müşteri: öğrenciler; Hedef pazar: Türkiye; Fiyatlandırma: aylık 200 TRY; Özellikler: liste, plan; Web sitesi: yok; Rakipler: yok; Hedef: büyümek",
    ),
  );
  assert.equal(next.status, "ready");
  assert.equal(next.allowIncomplete, false);
  assert.equal(next.product.pricing.value.amount, 200);
  assert.equal(
    next.product.productDescription.value,
    s.product.productDescription.value,
  );
  const again = await c.intakes.message(
    s.intakeId,
    message(next, "reply", "Fiyatlandırma: bilmiyorum"),
  );
  assert.equal(again.product.pricing.value, null);
  assert.equal(again.status, "needs_input");
});
test("fixture natural-language follow-up produces ready profile", async (t) => {
  const c = await setup(t);
  const s = await c.intakes.create(create());
  const next = await c.intakes.message(s.intakeId, {
    ...require("../contracts/examples/intake.message.request.json"),
    clientMessageId: randomUUID(),
  });
  assert.equal(next.status, "ready");
  assert.deepEqual(next.missingFields, []);
});
test("stale approvals rejected, duplicate approval launches Strategy once", async (t) => {
  let calls = 0;
  const c = await setup(t, {
    strategy: async () => {
      calls++;
      return structuredClone(fixture.buildSuggestion);
    },
  });
  const id = await waiting(c);
  await assert.rejects(c.orchestrator.approve(id, approve(2)), {
    code: "REVISION_CONFLICT",
  });
  const req = approve();
  const [a, b] = await Promise.all([
    c.orchestrator.approve(id, req),
    c.orchestrator.approve(id, req),
  ]);
  assert.deepEqual(a, b);
  await c.orchestrator.idle();
  assert.equal(calls, 1);
  await assert.rejects(c.orchestrator.approve(id, approve()), {
    code: "IDEMPOTENCY_CONFLICT",
  });
});
test("correction cancels old run; changed intake produces new immutable run", async (t) => {
  const c = await setup(t);
  const id = await waiting(c);
  const old = c.orchestrator.get(id);
  const req = approve(1, "request_changes");
  await c.orchestrator.approve(id, req);
  assert.equal(c.orchestrator.get(id).snapshot.status, "cancelled");
  assert.equal(c.orchestrator.get(id).events.at(-1).type, "run.cancelled");
  await assert.rejects(c.orchestrator.approve(id, approve()), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  const s = (await c.intakes.get(old.input.intakeId)).snapshot;
  const changed = await c.intakes.message(
    s.intakeId,
    message(s, "reply", "Hedef pazar: Türkiye"),
  );
  const next = await c.intakes.message(s.intakeId, message(changed));
  await c.orchestrator.analyze(analyze(next));
  await c.orchestrator.idle();
  assert.equal(c.orchestrator.get(id).input.product.targetMarket.value, null);
  assert.equal(next.product.targetMarket.value, "Türkiye");
});
test("timeout aborts adapter and preserves validated specialist output", async (t) => {
  let aborted = false;
  const c = await setup(
    t,
    {
      research: async (_, { onStep, signal }) => {
        await onStep({ task: "marketing", status: "running" });
        await onStep({
          task: "marketing",
          status: "finished",
          output: fixture.research.data.marketing,
        });
        return new Promise((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve(null);
            },
            { once: true },
          ),
        );
      },
    },
    { timeoutMs: 25 },
  );
  const id = await waiting(c);
  const r = c.orchestrator.get(id);
  assert(aborted);
  assert.equal(r.snapshot.review.research.status, "partial");
  assert.deepEqual(
    r.snapshot.review.research.data.marketing,
    fixture.research.data.marketing,
  );
  assert.equal(r.snapshot.review.research.data.trends.status, "failed");
});
test("invalid agent JSON/object is failed and dependency skipped; memory still attempted", async (t) => {
  const c = await setup(t, { strategy: async () => "{broken JSON" });
  const r = await complete(c);
  assert.equal(r.snapshot.status, "failed");
  assert.equal(r.snapshot.result.buildSuggestion.error.code, "INVALID_OUTPUT");
  assert.equal(r.snapshot.result.testResults.status, "skipped");
  assert.equal(r.snapshot.result.memoryUpdate.status, "completed");
});
test("memory write failure preserves all usable results and finishes partial", async (t) => {
  const c = await setup(t, {
    memoryUpdate: async () => {
      throw new AppError("STORAGE_FAILED", "Hafıza yazılamadı.", 500, true);
    },
  });
  const r = await complete(c);
  assert.equal(r.snapshot.status, "partial");
  assert.equal(r.snapshot.result.testResults.status, "completed");
  assert.equal(r.snapshot.result.memoryUpdate.data, null);
  assert.equal(r.events.at(-1).type, "run.finished");
});
test("simulator cannot change ids, arithmetic, verdicts or criterion references", async (t) => {
  for (const mutate of [
    (x) => (x.scenarios[0].scenarioId = "fake"),
    (x) => (x.scenarios[0].metrics.monthlyProfit = 9),
    (x) => (x.evaluation.scenarioAssessments[0].outcome = "failure"),
    (x) =>
      (x.evaluation.scenarioAssessments[0].reasons[0].criterionIds = ["fake"]),
  ]) {
    const c = await setup(t, {
      simulate: async () => {
        const out = structuredClone(fixture.testResults);
        mutate(out.data);
        return out;
      },
    });
    const r = await complete(c);
    assert.equal(r.snapshot.result.testResults.error.code, "INVALID_OUTPUT");
  }
});
test("restart retains approval gate and idempotency without re-running research", async (t) => {
  const c = await setup(t);
  const id = await waiting(c);
  const second = new Orchestrator(c.store, c.intakes, c.adapters);
  await second.init();
  assert.equal(second.get(id).snapshot.status, "awaiting_approval");
  assert.equal(second.jobs.size, 0);
  const r = second.get(id);
  assert.equal((await second.analyze(r.request)).runId, id);
  await second.approve(id, approve());
  await second.idle();
  assert.equal(second.get(id).snapshot.status, "completed");
});
test("interrupted active run keeps completed outputs and terminates without retrying Strategy", async (t) => {
  let calls = 0;
  const c = await setup(t, {
    strategy: async () => {
      calls++;
      return fixture.buildSuggestion;
    },
  });
  const id = await waiting(c);
  await c.orchestrator.mutate(id, (r) => {
    r.snapshot.status = "running";
  });
  const next = new Orchestrator(c.store, c.intakes, c.adapters);
  await next.init();
  assert.equal(next.get(id).snapshot.status, "failed");
  assert.equal(next.get(id).snapshot.result.research.status, "completed");
  assert.equal(calls, 0);
});
test("failed extraction is atomic and retryable", async (t) => {
  const c = await setup(t);
  const s = await c.intakes.create(create());
  const bad = new IntakeService(c.store, {
    extractor: async () => ({ product: {}, questions: [], limitations: [] }),
  });
  await assert.rejects(bad.message(s.intakeId, message(s, "reply", "hello")), {
    code: "INVALID_OUTPUT",
  });
  assert.deepEqual((await c.intakes.get(s.intakeId)).snapshot, s);
});
test("live input never silently falls back to demo", async (t) => {
  const c = await setup(t);
  let s = await c.intakes.create({ ...create(), mode: "live" });
  s = await c.intakes.message(s.intakeId, message(s));
  await assert.rejects(c.orchestrator.analyze(analyze(s)), {
    code: "TOOL_UNAVAILABLE",
  });
});

test("approval cannot race ahead of research and same active request remains idempotent", async (t) => {
  let release;
  const c = await setup(
    t,
    { memoryRead: () => new Promise((r) => (release = r)) },
    { timeoutMs: 2000 },
  );
  const s = await ready(c),
    req = analyze(s),
    a = await c.orchestrator.analyze(req);
  assert.equal((await c.orchestrator.analyze(req)).runId, a.runId);
  await assert.rejects(c.orchestrator.approve(a.runId, approve()), {
    code: "APPROVAL_REQUIRED",
  });
  await assert.rejects(
    c.orchestrator.analyze({ ...req, clientRequestId: randomUUID() }),
    { code: "BUSY" },
  );
  while (!release) await new Promise((r) => setImmediate(r));
  release(fixture.memoryContext);
  await c.orchestrator.idle();
});
test("demo rejects conflicting known profile facts", async (t) => {
  const c = await setup(t);
  let s = await c.intakes.create(create());
  s = await c.intakes.message(
    s.intakeId,
    message(s, "reply", "Hedef pazar: Almanya"),
  );
  s = await c.intakes.message(s.intakeId, message(s));
  await assert.rejects(c.orchestrator.analyze(analyze(s)), {
    code: "TOOL_UNAVAILABLE",
  });
});
test("a running agent cannot emit skipped and break event transitions", async (t) => {
  const c = await setup(t, {
    strategy: async () => ({
      status: "skipped",
      origin: "none",
      data: null,
      error: null,
    }),
  });
  const r = await complete(c);
  assert.equal(r.snapshot.result.buildSuggestion.error.code, "INVALID_OUTPUT");
  checks.checkEvents(r.events);
});
test("intake concurrent replies commit exactly one revision", async (t) => {
  const c = await setup(t);
  const s = await c.intakes.create(create());
  const results = await Promise.allSettled([
    c.intakes.message(s.intakeId, message(s)),
    c.intakes.message(s.intakeId, message(s)),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    results.find((x) => x.status === "rejected").reason.code,
    "REVISION_CONFLICT",
  );
});
test("approval waiting uses no phase timeout budget", async (t) => {
  const c = await setup(t, {}, { phaseTimeoutMs: 500 });
  const id = await waiting(c);
  await new Promise((r) => setTimeout(r, 550));
  assert.equal(c.orchestrator.get(id).snapshot.status, "awaiting_approval");
  await c.orchestrator.approve(id, approve());
  await c.orchestrator.idle();
  assert.equal(c.orchestrator.get(id).snapshot.status, "completed");
});
test("memory read failure still reaches review and produces partial result", async (t) => {
  const c = await setup(t, {
    memoryRead: async () => {
      throw new AppError("TOOL_UNAVAILABLE", "Memory offline");
    },
  });
  const r = await complete(c);
  assert.equal(r.snapshot.status, "partial");
  assert.equal(r.snapshot.review.memoryContext.status, "failed");
  assert.equal(r.snapshot.result.research.status, "completed");
});
test("run storage failure never publishes uncommitted final success", async (t) => {
  const c = await setup(t);
  const id = await waiting(c);
  const write = c.store.write.bind(c.store);
  let rejected = false;
  c.store.write = async (file, value) => {
    if (file === `runs/${id}.json` && value.snapshot.status === "completed") {
      rejected = true;
      throw new AppError("STORAGE_FAILED", "Disk full", 500);
    }
    return write(file, value);
  };
  await c.orchestrator.approve(id, approve());
  await c.orchestrator.idle();
  assert(rejected);
  assert.throws(() => c.orchestrator.get(id), { code: "STORAGE_FAILED" });
  const disk = await c.store.read(`runs/${id}.json`);
  assert.notEqual(disk.events.at(-1).type, "run.finished");
  assert.equal(
    disk.snapshot.steps.find((s) => s.stepId === "tests.run").status,
    "completed",
  );
});
