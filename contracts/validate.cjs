/* Contract fixtures and cross-document invariants; this is not a backend runtime. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const analysis = read("analysis.schema.json");
const eventSchema = read("events.schema.json");
const memorySchema = read("memory.schema.json");
const intakeSchema = read("intake.schema.json");
for (const schema of [intakeSchema, analysis, eventSchema, memorySchema])
  ajv.addSchema(schema);
const typeId = (type) => `${analysis.$id}#/$defs/${type}`;
function validate(id, value) {
  const check = ajv.getSchema(id);
  assert(check, `Missing schema: ${id}`);
  assert(check(value), `${id}: ${ajv.errorsText(check.errors)}`);
}
// Compile every public type, not only those reached from Response.
for (const name of Object.keys(analysis.$defs))
  assert(ajv.getSchema(typeId(name)));
for (const name of Object.keys(intakeSchema.$defs))
  assert(ajv.getSchema(`${intakeSchema.$id}#/$defs/${name}`));
const terminal = new Set(["completed", "partial", "failed", "skipped"]);
const stepIds = [
  "memory.read",
  "research",
  "research.risk_reward",
  "research.marketing",
  "research.rivals",
  "research.trends",
  "strategy.build",
  "tests.run",
  "memory.update",
];
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
function unique(items, key) {
  assert.equal(
    new Set(items.map((x) => x[key])).size,
    items.length,
    `Duplicate ${key}`,
  );
}
function missingFields(product) {
  return Object.entries(product)
    .filter(([key, field]) => {
      if (field.status === "unknown" || field.status === "declined")
        return true;
      if (key !== "pricing" || field.status !== "provided") return false;
      const p = field.value;
      return (
        ["undecided", "custom"].includes(p.model) ||
        (p.model !== "free" &&
          (p.amount === null ||
            p.currency === null ||
            p.billingPeriod === null))
      );
    })
    .map(([key]) => key);
}
function checkIntake(value) {
  validate(intakeSchema.$id, value);
  unique(value.messages, "id");
  unique(value.questions, "id");
  unique(value.questions, "field");
  const userIds = new Set(
    value.messages.filter((x) => x.role === "user").map((x) => x.id),
  );
  for (const field of Object.values(value.product)) {
    for (const id of field.sourceMessageIds)
      assert(userIds.has(id), `Invalid user evidence ${id}`);
  }
  const missing = missingFields(value.product);
  assert.deepEqual([...value.missingFields].sort(), [...missing].sort());
  const canStart =
    value.product.productDescription.status === "provided" &&
    (missing.length === 0 || value.allowIncomplete);
  assert.equal(value.status, canStart ? "ready" : "needs_input");
  if (canStart) assert.equal(value.questions.length, 0);
  else {
    const askable = missing.filter(
      (key) =>
        key === "productDescription" ||
        value.product[key].status !== "declined",
    );
    assert.deepEqual(
      value.questions.map((x) => x.field).sort(),
      askable.sort(),
    );
    for (const question of value.questions)
      assert.equal(question.blocking, question.field === "productDescription");
  }
  if (missing.length) assert(value.limitations.length > 0);
  if (
    value.product.pricing.status === "provided" &&
    value.product.pricing.value.model === "free"
  ) {
    assert.equal(value.product.pricing.value.amount, 0);
  }
}
function checkStart(request, intake) {
  validate(typeId("Request"), request);
  checkIntake(intake);
  assert.equal(request.intakeId, intake.intakeId);
  assert.equal(
    request.intakeRevision,
    intake.revision,
    "Stale intake revision",
  );
  assert.equal(intake.status, "ready", "Research must wait for intake");
}
function assertOrigins(value, mode) {
  if (!value || typeof value !== "object") return;
  if (mode === "live") {
    assert.notEqual(value.origin, "mock");
    assert.notEqual(value.evidenceType, "mock");
  }
  for (const child of Object.values(value)) assertOrigins(child, mode);
}
function checkResearch(research) {
  if (!research.data) return;
  const parts = ["riskReward", "marketing", "rivals", "trends"].map(
    (k) => research.data[k],
  );
  const allDone = parts.every((p) => p.status === "completed");
  assert.equal(research.status, allDone ? "completed" : "partial");
  assert(
    parts.some((p) => p.data),
    "Research needs at least one usable specialist",
  );
  const allSourceIds = [];
  for (const part of parts) {
    if (!part.data) continue;
    const data = part.data;
    unique(data.sources, "id");
    const sources = new Map(data.sources.map((source) => [source.id, source]));
    allSourceIds.push(...sources.keys());
    for (const list of ["risks", "rewards", "findings", "competitors"]) {
      const findings = data[list] || [];
      unique(findings, "id");
      for (const finding of findings) {
        for (const id of finding.sourceIds)
          assert(sources.has(id), `Missing source ${id}`);
        if (finding.evidenceType === "sourced") {
          assert(finding.sourceIds.length > 0, "Sourced claim needs evidence");
          for (const id of finding.sourceIds)
            assert(sources.get(id).accessedAt);
        }
      }
    }
  }
  assert.equal(
    new Set(allSourceIds).size,
    allSourceIds.length,
    "Source IDs must be globally unique",
  );
  if (research.data.rivals.status === "completed") {
    assert.equal(research.data.rivals.data.competitors.length, 3);
  }
}
function checkTests(build, tests) {
  const evaluation = { data: tests.data?.evaluation };
  if (!build.data) return;
  const plan = build.data.testPlan;
  unique(plan.scenarios, "id");
  unique(plan.criteria, "id");
  assert.deepEqual(plan.scenarios.map((x) => x.label).sort(), [
    "optimistic",
    "pessimistic",
  ]);
  if (!tests.data) return;
  unique(tests.data.scenarios, "scenarioId");
  assert.deepEqual(
    tests.data.scenarios.map((x) => x.scenarioId).sort(),
    plan.scenarios.map((x) => x.id).sort(),
  );
  for (const result of tests.data.scenarios) {
    const a = plan.scenarios.find(
      (x) => x.id === result.scenarioId,
    ).assumptions;
    const customers = Math.floor(a.monthlyVisitors * a.conversionRate);
    const revenue = round(customers * a.monthlyPrice);
    const profit = round(revenue - a.monthlyCosts);
    assert.deepEqual(result.metrics, {
      payingCustomers: customers,
      monthlyRevenue: revenue,
      monthlyProfit: profit,
      runwayMonths: profit < 0 ? round(a.initialCash / Math.abs(profit)) : null,
    });
    unique(result.checks, "criterionId");
    assert.deepEqual(
      result.checks.map((x) => x.criterionId).sort(),
      plan.criteria.map((x) => x.id).sort(),
    );
    for (const check of result.checks) {
      const criterion = plan.criteria.find((x) => x.id === check.criterionId);
      assert.equal(check.observedValue, result.metrics[criterion.metric]);
      assert.equal(
        check.passed,
        criterion.operator === "gte"
          ? check.observedValue >= criterion.threshold
          : check.observedValue <= criterion.threshold,
      );
    }
    assert.equal(
      result.outcome,
      result.checks.every((x) => x.passed) ? "success" : "failure",
    );
  }
  if (!evaluation.data) return;
  const assessments = evaluation.data.scenarioAssessments;
  unique(assessments, "scenarioId");
  assert.deepEqual(
    assessments.map((x) => x.scenarioId).sort(),
    tests.data.scenarios.map((x) => x.scenarioId).sort(),
  );
  for (const item of assessments) {
    const test = tests.data.scenarios.find(
      (x) => x.scenarioId === item.scenarioId,
    );
    assert.equal(
      item.outcome,
      test.outcome,
      "Strategy cannot override a deterministic result",
    );
    for (const reason of item.reasons) {
      for (const id of reason.criterionIds)
        assert(
          plan.criteria.some((x) => x.id === id),
          `Missing criterion ${id}`,
        );
    }
  }
  const outcomes = new Set(assessments.map((x) => x.outcome));
  assert.equal(
    evaluation.data.overallOutcome,
    outcomes.size === 1 ? [...outcomes][0] : "inconclusive",
  );
}
function checkResponse(result) {
  validate(typeId("Response"), result);
  assert.equal(result.input.product.productDescription.status, "provided");
  if (missingFields(result.input.product).length) {
    assert(
      result.input.allowIncomplete,
      "Explicit consent is required for missing data",
    );
    assert(result.input.limitations.length > 0);
  }
  if (result.buildSuggestion.status !== "skipped") {
    assert(
      result.review && result.approval,
      "Strategy requires recorded approval",
    );
    assert.equal(result.approval.request.decision, "approve");
    assert.equal(
      result.approval.request.reviewRevision,
      result.review.revision,
    );
  }
  if (result.review) {
    assert.deepEqual(result.review.input, result.input);
    assert.deepEqual(result.review.research, result.research);
    assert.deepEqual(result.review.memoryContext, result.memoryContext);
  }
  assertOrigins(result, result.input.mode);
  checkResearch(result.research);
  checkTests(result.buildSuggestion, result.testResults);
  if (result.buildSuggestion.status !== "completed") {
    assert.equal(result.testResults.status, "skipped");
  }
  const coreOK = [result.buildSuggestion, result.testResults].every(
    (x) => x.status === "completed",
  );
  const supportOK = [
    result.memoryContext,
    result.research,
    result.memoryUpdate,
  ].every((x) => x.status === "completed");
  assert.equal(
    result.status,
    !coreOK ? "failed" : supportOK ? "completed" : "partial",
  );
  assert.equal(
    Date.parse(result.finishedAt) - Date.parse(result.createdAt),
    result.durationMs,
  );
  if (result.memoryContext.data)
    assert.equal(result.memoryContext.data.namespace, result.input.mode);
  if (result.memoryUpdate.data) {
    assert.equal(result.memoryUpdate.data.namespace, result.input.mode);
    assert.equal(result.memoryUpdate.data.recordId, result.runId);
    assert(
      Date.parse(result.memoryUpdate.data.updatedAt) <=
        Date.parse(result.finishedAt),
    );
  }
}
function outputFor(result, id) {
  const top = {
    "memory.read": "memoryContext",
    research: "research",
    "strategy.build": "buildSuggestion",
    "tests.run": "testResults",
    "memory.update": "memoryUpdate",
  };
  if (top[id]) return result[top[id]];
  const child = {
    "research.risk_reward": "riskReward",
    "research.marketing": "marketing",
    "research.rivals": "rivals",
    "research.trends": "trends",
  };
  return result.research.data?.[child[id]];
}
function checkEvents(events) {
  const states = new Map();
  let started = false;
  let finished = false;
  let prevTime = -Infinity;
  let approved = false;
  let review = null;
  const isDone = (id) => terminal.has(states.get(id)?.status);
  const dependencies = {
    "strategy.build": ["memory.read", "research"],
    "tests.run": ["strategy.build"],
    "memory.update": ["tests.run"],
  };
  for (const [i, event] of events.entries()) {
    validate(eventSchema.$id, event);
    assert(!finished, "No events after run.finished");
    assert.equal(event.sequence, i + 1);
    assert.equal(event.runId, events[0].runId);
    assert(Date.parse(event.timestamp) >= prevTime);
    prevTime = Date.parse(event.timestamp);
    if (i === 0) assert.equal(event.type, "run.accepted");
    else assert.notEqual(event.type, "run.accepted");
    if (event.type === "run.accepted") {
      assert.equal(event.payload.runId, event.runId);
      assert.equal(event.payload.status, "queued");
    }
    if (event.type === "run.started") {
      assert(!started);
      started = true;
    }
    if (event.type === "run.awaiting_approval") {
      assert(isDone("research") && isDone("memory.read"));
      review = event.payload;
    }
    if (event.type === "run.approved") {
      assert(review);
      assert.equal(event.payload.request.reviewRevision, review.revision);
      approved = true;
    }
    if (event.type.startsWith("step.")) {
      assert(started);
      const step = event.payload.step;
      const previous = states.get(step.stepId);
      if (event.type === "step.started") {
        assert(!previous, "Step may only start once");
        assert.equal(step.status, "running");
        assert.equal(step.output, null);
        assert.equal(step.startedAt, event.timestamp);
        assert.equal(step.finishedAt, null);
        if (step.parentStepId)
          assert.equal(states.get(step.parentStepId)?.status, "running");
        for (const dep of dependencies[step.stepId] || [])
          assert(isDone(dep), `${step.stepId} before ${dep}`);
        if (step.stepId === "tests.run")
          assert.equal(states.get("strategy.build").status, "completed");
        if (step.stepId === "strategy.build")
          assert(approved, "Strategy requires explicit review approval");
      } else {
        assert(terminal.has(step.status));
        assert(step.output);
        assert.equal(step.output.status, step.status);
        assert.equal(step.finishedAt, event.timestamp);
        if (step.status === "skipped") {
          assert(!previous);
          assert.equal(step.startedAt, null);
        } else {
          assert.equal(previous?.status, "running");
          assert.equal(step.startedAt, previous.startedAt);
        }
        if (step.stepId === "research") {
          for (const child of stepIds.filter((x) => x.startsWith("research.")))
            assert(isDone(child));
        }
      }
      states.set(step.stepId, step);
    }
    assert.equal(
      event.progress.settledSteps,
      [...states.values()].filter((x) => terminal.has(x.status)).length,
    );
    if (event.type === "run.finished") {
      assert(started);
      assert(
        stepIds.every(isDone),
        "Every step must settle before run.finished",
      );
      const result = event.payload.result;
      checkResponse(result);
      assert.equal(result.runId, event.runId);
      assert.equal(result.finishedAt, event.timestamp);
      for (const id of stepIds) {
        const output = outputFor(result, id);
        if (output)
          assert.deepEqual(
            states.get(id).output,
            output,
            `Final result mismatch for ${id}`,
          );
      }
      finished = true;
    }
  }
  assert(finished, "Missing terminal event");
  return [...states.values()];
}
module.exports = {
  validate,
  typeId,
  missingFields,
  checkIntake,
  checkResearch,
  checkTests,
  checkResponse,
  checkEvents,
  assertOrigins,
};
if (require.main === module) {
  const fixtures = [
    ["analyze.request.json", "Request"],
    ["analyze.accepted.json", "Accepted"],
    ["analyze.error.response.json", "ApiError"],
    ["analyze.snapshot.json", "Snapshot"],
    ["memory.record.json", "MemoryRecord"],
    ["approval.request.json", "ApprovalRequest"],
    ["analyze.awaiting-approval.snapshot.json", "Snapshot"],
  ];
  for (const [name, type] of fixtures) {
    validate(typeId(type), read(`examples/${name}`));
  }
  for (const name of [
    "analyze.demo.response.json",
    "analyze.partial.response.json",
    "analyze.failed.response.json",
  ]) {
    checkResponse(read(`examples/${name}`));
  }
  const events = read("examples/ui.events.json");
  const states = checkEvents(events);
  const failureEvents = read("examples/ui.failure.events.json");
  checkEvents(failureEvents);
  assert.deepEqual(
    failureEvents.at(-1).payload.result,
    read("examples/analyze.failed.response.json"),
  );
  const snapshot = read("examples/analyze.snapshot.json");
  assert.equal(snapshot.lastSequence, events.length);
  assert.deepEqual(snapshot.steps, states);
  assert.deepEqual(snapshot.result, events.at(-1).payload.result);
  assert.equal(snapshot.status, snapshot.result.status);
  assert.deepEqual(
    snapshot.result,
    read("examples/analyze.demo.response.json"),
  );
  const startRequest = read("examples/analyze.request.json");
  for (const [key, value] of Object.entries(startRequest))
    assert.deepEqual(snapshot.result.input[key], value);
  for (const [file, type] of [
    ["intake.create.request.json", "CreateRequest"],
    ["intake.message.request.json", "MessageRequest"],
    ["intake.continue.request.json", "MessageRequest"],
  ])
    validate(`${intakeSchema.$id}#/$defs/${type}`, read(`examples/${file}`));
  const intakeWaiting = read("examples/intake.needs-input.response.json");
  const intakeReady = read("examples/intake.ready.response.json");
  const intakeIncomplete = read(
    "examples/intake.incomplete-ready.response.json",
  );
  for (const intake of [intakeWaiting, intakeReady, intakeIncomplete])
    checkIntake(intake);
  const intakeRecord = read("examples/intake.record.json");
  validate(`${intakeSchema.$id}#/$defs/Record`, intakeRecord);
  assert.deepEqual(intakeRecord.snapshot, intakeReady);
  assert.deepEqual(intakeRecord.createResponse, intakeWaiting);
  assert.equal(
    intakeRecord.createRequest.message,
    intakeWaiting.messages[0].content,
  );
  assert.equal(
    intakeReady.revision,
    intakeRecord.processedMessages[0].request.expectedRevision + 1,
  );
  assert.deepEqual(intakeRecord.processedMessages[0].response, intakeReady);
  const submittedMessage = intakeRecord.processedMessages[0].request;
  assert.equal(
    intakeReady.messages.find((x) => x.id === submittedMessage.clientMessageId)
      .content,
    submittedMessage.message,
  );
  checkStart(startRequest, intakeReady);
  checkStart(startRequest, intakeIncomplete); // Same ID/revision are independent alternative fixtures.
  assert.deepEqual(snapshot.result.input.product, intakeReady.product);
  assert.deepEqual(snapshot.result.input.limitations, intakeReady.limitations);
  assert.equal(
    snapshot.result.input.allowIncomplete,
    intakeReady.allowIncomplete,
  );
  assert.equal(snapshot.result.input.language, intakeReady.language);
  assert.equal(snapshot.result.input.mode, intakeReady.mode);
  const researchInput = read("examples/research.input.json");
  validate(typeId("ResearchInput"), researchInput);
  assert.deepEqual(researchInput.input, snapshot.result.input);
  assert.equal(researchInput.runId, snapshot.runId);
  const record = read("examples/memory.record.json");
  validate(memorySchema.$id, record);
  assert.equal(record.recordId, snapshot.runId);
  assert.equal(record.namespace, record.analysis.input.mode);
  assert.equal(record.analysisStatus, "completed");
  for (const [key, value] of Object.entries(record.analysis))
    assert.deepEqual(value, snapshot.result[key]);
  assert.deepEqual(snapshot.result.memoryUpdate.data, {
    namespace: record.namespace,
    recordId: record.recordId,
    revision: record.revision,
    updatedAt: record.updatedAt,
  });
  const wire = fs.readFileSync(
    path.join(__dirname, "examples/ui.events.sse"),
    "utf8",
  );
  const frames = wire
    .trim()
    .split("\n\n")
    .filter((x) => x.startsWith("id:"));
  assert.equal(frames.length, events.length);
  for (const [i, frame] of frames.entries()) {
    const lines = frame.split("\n");
    assert.equal(lines[0], `id: ${events[i].sequence}`);
    assert.equal(lines[1], `event: ${events[i].type}`);
    assert.deepEqual(JSON.parse(lines[2].slice(6)), events[i]);
  }
  let rejected = 0;
  function rejects(label, original, mutate, check) {
    const broken = structuredClone(original);
    mutate(broken);
    assert.throws(
      () => check(broken),
      undefined,
      `Expected rejection: ${label}`,
    );
    rejected++;
  }
  const request = read("examples/analyze.request.json");
  rejects(
    "unknown request field",
    request,
    (x) => (x.unknown = true),
    (x) => validate(typeId("Request"), x),
  );
  rejects(
    "wrong test mode",
    snapshot.result,
    (x) => (x.input.testMode = "real"),
    checkResponse,
  );
  rejects(
    "partial without error",
    snapshot.result,
    (x) => (x.research.status = "partial"),
    checkResponse,
  );
  rejects(
    "false simulation verdict",
    snapshot.result,
    (x) =>
      (x.testResults.data.evaluation.scenarioAssessments[0].outcome =
        "failure"),
    checkResponse,
  );
  rejects(
    "unresolved source",
    snapshot.result,
    (x) => (x.research.data.rivals.data.competitors[0].sourceIds = ["missing"]),
    checkResponse,
  );
  rejects(
    "incorrect math",
    snapshot.result,
    (x) => (x.testResults.data.scenarios[0].metrics.monthlyProfit = 999),
    checkResponse,
  );
  rejects(
    "duplicate event sequence",
    events,
    (x) => (x[3].sequence = 3),
    checkEvents,
  );
  rejects(
    "incorrect parent",
    events,
    (x) => (x[4].payload.step.parentStepId = null),
    checkEvents,
  );
  rejects(
    "incorrect progress",
    events,
    (x) => (x[8].progress.settledSteps = 10),
    checkEvents,
  );
  rejects(
    "early final event",
    events,
    (x) => x.splice(2, x.length - 3),
    checkEvents,
  );
  rejects(
    "invalid step output type",
    events,
    (x) => (x[8].payload.step.output = snapshot.result.buildSuggestion),
    checkEvents,
  );
  rejects(
    "premature ready",
    intakeWaiting,
    (x) => (x.status = "ready"),
    checkIntake,
  );
  rejects(
    "invented unknown value",
    intakeWaiting,
    (x) =>
      (x.product.pricing.value = {
        model: "free",
        amount: 0,
        currency: null,
        billingPeriod: null,
      }),
    checkIntake,
  );
  rejects(
    "assistant as user evidence",
    intakeReady,
    (x) => (x.product.targetMarket.sourceMessageIds = [x.messages[1].id]),
    checkIntake,
  );
  rejects(
    "omitted missing fields",
    intakeWaiting,
    (x) => (x.missingFields = []),
    checkIntake,
  );
  rejects(
    "continue without description",
    intakeIncomplete,
    (x) => {
      x.product.productDescription = {
        status: "unknown",
        value: null,
        sourceMessageIds: [],
      };
      x.missingFields.push("productDescription");
    },
    checkIntake,
  );
  rejects(
    "stale profile revision",
    startRequest,
    (x) => (x.intakeRevision = 1),
    (x) => checkStart(x, intakeReady),
  );
  rejects(
    "bypass intake gate",
    startRequest,
    (x) => (x.intakeRevision = 1),
    (x) => checkStart(x, intakeWaiting),
  );
  rejects(
    "client injected profile",
    startRequest,
    (x) => (x.product = intakeReady.product),
    (x) => validate(typeId("Request"), x),
  );
  rejects(
    "missing research approval",
    snapshot.result,
    (x) => (x.approval = null),
    checkResponse,
  );
  rejects(
    "stale research approval",
    snapshot.result,
    (x) => (x.approval.request.reviewRevision = 2),
    checkResponse,
  );
  rejects(
    "altered approved profile",
    snapshot.result,
    (x) => (x.review.input.product.targetMarket.value = "Other"),
    checkResponse,
  );
  rejects(
    "missing consent",
    intakeIncomplete,
    (x) => (x.allowIncomplete = false),
    checkIntake,
  );
  console.log(
    `PASS: all schemas and fixtures; chat extraction/clarification/consent gates; ${events.length} success-path and ${failureEvents.length} failure-path events; SSE parity; memory and simulation invariants; ${rejected} invalid cases rejected.`,
  );
}
