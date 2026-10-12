/* Contract fixtures and cross-document invariants; this is not a backend runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const analysis = read('analysis.schema.json');
const eventSchema = read('events.schema.json');
const memorySchema = read('memory.schema.json');
for (const schema of [analysis, eventSchema, memorySchema]) ajv.addSchema(schema);
const typeId = type => `${analysis.$id}#/$defs/${type}`;
function validate(id, value) {
  const check = ajv.getSchema(id);
  assert(check, `Missing schema: ${id}`);
  assert(check(value), `${id}: ${ajv.errorsText(check.errors)}`);
}
// Compile every public type, not only those reached from Response.
for (const name of Object.keys(analysis.$defs)) assert(ajv.getSchema(typeId(name)));
const terminal = new Set(['completed', 'partial', 'failed', 'skipped']);
const stepIds = ['memory.read', 'research', 'research.risk_reward', 'research.marketing',
  'research.rivals', 'research.trends', 'strategy.build', 'tests.run', 'strategy.evaluate', 'memory.update'];
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
function unique(items, key) {
  assert.equal(new Set(items.map(x => x[key])).size, items.length, `Duplicate ${key}`);
}
function assertOrigins(value, mode) {
  if (!value || typeof value !== 'object') return;
  if (mode === 'live') {
    assert.notEqual(value.origin, 'mock');
    assert.notEqual(value.evidenceType, 'mock');
  }
  for (const child of Object.values(value)) assertOrigins(child, mode);
}
function checkResearch(research) {
  if (!research.data) return;
  const parts = ['riskReward', 'marketing', 'rivals', 'trends'].map(k => research.data[k]);
  const allDone = parts.every(p => p.status === 'completed');
  assert.equal(research.status, allDone ? 'completed' : 'partial');
  assert(parts.some(p => p.data), 'Research needs at least one usable specialist');
  const allSourceIds = [];
  for (const part of parts) {
    if (!part.data) continue;
    const data = part.data;
    unique(data.sources, 'id');
    const sources = new Map(data.sources.map(source => [source.id, source]));
    allSourceIds.push(...sources.keys());
    for (const list of ['risks', 'rewards', 'findings', 'competitors']) {
      const findings = data[list] || [];
      unique(findings, 'id');
      for (const finding of findings) {
        for (const id of finding.sourceIds) assert(sources.has(id), `Missing source ${id}`);
        if (finding.evidenceType === 'sourced') {
          assert(finding.sourceIds.length > 0, 'Sourced claim needs evidence');
          for (const id of finding.sourceIds) assert(sources.get(id).accessedAt);
        }
      }
    }
  }
  assert.equal(new Set(allSourceIds).size, allSourceIds.length, 'Source IDs must be globally unique');
  if (research.data.rivals.status === 'completed') {
    assert.equal(research.data.rivals.data.competitors.length, 3);
  }
}
function checkTests(build, tests, evaluation) {
  if (!build.data) return;
  const plan = build.data.testPlan;
  unique(plan.scenarios, 'id'); unique(plan.criteria, 'id');
  assert.deepEqual(plan.scenarios.map(x => x.label).sort(), ['optimistic', 'pessimistic']);
  if (!tests.data) return;
  unique(tests.data.scenarios, 'scenarioId');
  assert.deepEqual(tests.data.scenarios.map(x => x.scenarioId).sort(), plan.scenarios.map(x => x.id).sort());
  for (const result of tests.data.scenarios) {
    const a = plan.scenarios.find(x => x.id === result.scenarioId).assumptions;
    const customers = Math.floor(a.monthlyVisitors * a.conversionRate);
    const revenue = round(customers * a.monthlyPrice);
    const profit = round(revenue - a.monthlyCosts);
    assert.deepEqual(result.metrics, { payingCustomers: customers, monthlyRevenue: revenue,
      monthlyProfit: profit, runwayMonths: profit < 0 ? round(a.initialCash / Math.abs(profit)) : null });
    unique(result.checks, 'criterionId');
    assert.deepEqual(result.checks.map(x => x.criterionId).sort(), plan.criteria.map(x => x.id).sort());
    for (const check of result.checks) {
      const criterion = plan.criteria.find(x => x.id === check.criterionId);
      assert.equal(check.observedValue, result.metrics[criterion.metric]);
      assert.equal(check.passed, criterion.operator === 'gte'
        ? check.observedValue >= criterion.threshold : check.observedValue <= criterion.threshold);
    }
    assert.equal(result.outcome, result.checks.every(x => x.passed) ? 'success' : 'failure');
  }
  if (!evaluation.data) return;
  const assessments = evaluation.data.scenarioAssessments;
  unique(assessments, 'scenarioId');
  assert.deepEqual(assessments.map(x => x.scenarioId).sort(), tests.data.scenarios.map(x => x.scenarioId).sort());
  for (const item of assessments) {
    const test = tests.data.scenarios.find(x => x.scenarioId === item.scenarioId);
    assert.equal(item.outcome, test.outcome, 'Strategy cannot override a deterministic result');
    for (const reason of item.reasons) {
      for (const id of reason.criterionIds) assert(plan.criteria.some(x => x.id === id), `Missing criterion ${id}`);
    }
  }
  const outcomes = new Set(assessments.map(x => x.outcome));
  assert.equal(evaluation.data.overallOutcome, outcomes.size === 1 ? [...outcomes][0] : 'inconclusive');
}
function checkResponse(result) {
  validate(typeId('Response'), result);
  assertOrigins(result, result.input.mode);
  checkResearch(result.research);
  checkTests(result.buildSuggestion, result.testResults, result.evaluation);
  if (result.buildSuggestion.status !== 'completed') {
    assert.equal(result.testResults.status, 'skipped');
    assert.equal(result.evaluation.status, 'skipped');
  } else if (result.testResults.status !== 'completed') {
    assert.equal(result.evaluation.status, 'skipped');
  }
  const coreOK = [result.buildSuggestion, result.testResults, result.evaluation].every(x => x.status === 'completed');
  const supportOK = [result.memoryContext, result.research, result.memoryUpdate].every(x => x.status === 'completed');
  assert.equal(result.status, !coreOK ? 'failed' : supportOK ? 'completed' : 'partial');
  assert.equal(Date.parse(result.finishedAt) - Date.parse(result.createdAt), result.durationMs);
  if (result.memoryContext.data) assert.equal(result.memoryContext.data.namespace, result.input.mode);
  if (result.memoryUpdate.data) {
    assert.equal(result.memoryUpdate.data.namespace, result.input.mode);
    assert.equal(result.memoryUpdate.data.recordId, result.runId);
    assert(Date.parse(result.memoryUpdate.data.updatedAt) <= Date.parse(result.finishedAt));
  }
}
function outputFor(result, id) {
  const top = {'memory.read':'memoryContext', research:'research', 'strategy.build':'buildSuggestion',
    'tests.run':'testResults', 'strategy.evaluate':'evaluation', 'memory.update':'memoryUpdate'};
  if (top[id]) return result[top[id]];
  const child = {'research.risk_reward':'riskReward','research.marketing':'marketing',
    'research.rivals':'rivals','research.trends':'trends'};
  return result.research.data?.[child[id]];
}
function checkEvents(events) {
  const states = new Map(); let started = false; let finished = false;
  let prevTime = -Infinity;
  const isDone = id => terminal.has(states.get(id)?.status);
  const dependencies = {
    'strategy.build':['memory.read','research'], 'tests.run':['strategy.build'],
    'strategy.evaluate':['tests.run'], 'memory.update':['strategy.evaluate']
  };
  for (const [i, event] of events.entries()) {
    validate(eventSchema.$id, event);
    assert(!finished, 'No events after run.finished');
    assert.equal(event.sequence, i + 1); assert.equal(event.runId, events[0].runId);
    assert(Date.parse(event.timestamp) >= prevTime); prevTime = Date.parse(event.timestamp);
    if (i === 0) assert.equal(event.type, 'run.accepted');
    else assert.notEqual(event.type, 'run.accepted');
    if (event.type === 'run.accepted') {
      assert.equal(event.payload.runId, event.runId); assert.equal(event.payload.status, 'queued');
    }
    if (event.type === 'run.started') { assert(!started); started = true; }
    if (event.type.startsWith('step.')) {
      assert(started);
      const step = event.payload.step; const previous = states.get(step.stepId);
      if (event.type === 'step.started') {
        assert(!previous, 'Step may only start once');
        assert.equal(step.status, 'running'); assert.equal(step.output, null);
        assert.equal(step.startedAt, event.timestamp); assert.equal(step.finishedAt, null);
        if (step.parentStepId) assert.equal(states.get(step.parentStepId)?.status, 'running');
        for (const dep of dependencies[step.stepId] || []) assert(isDone(dep), `${step.stepId} before ${dep}`);
        if (step.stepId === 'tests.run') assert.equal(states.get('strategy.build').status, 'completed');
        if (step.stepId === 'strategy.evaluate') assert.equal(states.get('tests.run').status, 'completed');
      } else {
        assert(terminal.has(step.status)); assert(step.output);
        assert.equal(step.output.status, step.status);
        assert.equal(step.finishedAt, event.timestamp);
        if (step.status === 'skipped') { assert(!previous); assert.equal(step.startedAt, null); }
        else { assert.equal(previous?.status, 'running'); assert.equal(step.startedAt, previous.startedAt); }
        if (step.stepId === 'research') {
          for (const child of stepIds.filter(x => x.startsWith('research.'))) assert(isDone(child));
        }
      }
      states.set(step.stepId, step);
    }
    assert.equal(event.progress.settledSteps, [...states.values()].filter(x => terminal.has(x.status)).length);
    if (event.type === 'run.finished') {
      assert(started); assert(stepIds.every(isDone), 'Every step must settle before run.finished');
      const result = event.payload.result; checkResponse(result);
      assert.equal(result.runId, event.runId); assert.equal(result.finishedAt, event.timestamp);
      for (const id of stepIds) {
        const output = outputFor(result, id);
        if (output) assert.deepEqual(states.get(id).output, output, `Final result mismatch for ${id}`);
      }
      finished = true;
    }
  }
  assert(finished, 'Missing terminal event');
  return [...states.values()];
}
const fixtures = [
  ['analyze.request.json','Request'], ['analyze.accepted.json','Accepted'],
  ['analyze.error.response.json','ApiError'], ['analyze.snapshot.json','Snapshot'],
  ['memory.record.json','MemoryRecord']
];
for (const [name, type] of fixtures) { validate(typeId(type), read(`examples/${name}`)); }
for (const name of ['analyze.demo.response.json','analyze.partial.response.json','analyze.failed.response.json']) {
  checkResponse(read(`examples/${name}`));
}
const events = read('examples/ui.events.json');
const states = checkEvents(events);
const failureEvents = read('examples/ui.failure.events.json');
checkEvents(failureEvents);
assert.deepEqual(failureEvents.at(-1).payload.result, read('examples/analyze.failed.response.json'));
const snapshot = read('examples/analyze.snapshot.json');
assert.equal(snapshot.lastSequence, events.length);
assert.deepEqual(snapshot.steps, states);
assert.deepEqual(snapshot.result, events.at(-1).payload.result);
assert.equal(snapshot.status, snapshot.result.status);
assert.deepEqual(snapshot.result, read('examples/analyze.demo.response.json'));
assert.deepEqual(snapshot.result.input, read('examples/analyze.request.json'));
const record = read('examples/memory.record.json'); validate(memorySchema.$id, record);
assert.equal(record.recordId, snapshot.runId);
assert.equal(record.namespace, record.analysis.input.mode);
assert.equal(record.analysisStatus, 'completed');
for (const [key, value] of Object.entries(record.analysis)) assert.deepEqual(value, snapshot.result[key]);
assert.deepEqual(snapshot.result.memoryUpdate.data, {
  namespace: record.namespace, recordId: record.recordId, revision: record.revision, updatedAt: record.updatedAt
});
const wire = fs.readFileSync(path.join(__dirname, 'examples/ui.events.sse'), 'utf8');
const frames = wire.trim().split('\n\n').filter(x => x.startsWith('id:'));
assert.equal(frames.length, events.length);
for (const [i, frame] of frames.entries()) {
  const lines = frame.split('\n');
  assert.equal(lines[0], `id: ${events[i].sequence}`);
  assert.equal(lines[1], `event: ${events[i].type}`);
  assert.deepEqual(JSON.parse(lines[2].slice(6)), events[i]);
}
let rejected = 0;
function rejects(label, original, mutate, check) {
  const broken = structuredClone(original); mutate(broken);
  assert.throws(() => check(broken), undefined, `Expected rejection: ${label}`); rejected++;
}
const request = read('examples/analyze.request.json');
rejects('unknown request field', request, x => x.unknown = true, x => validate(typeId('Request'), x));
rejects('wrong test mode', request, x => x.testMode = 'real', x => validate(typeId('Request'), x));
rejects('partial without error', snapshot.result, x => x.research.status = 'partial', checkResponse);
rejects('false simulation verdict', snapshot.result, x => x.evaluation.data.scenarioAssessments[0].outcome = 'failure', checkResponse);
rejects('unresolved source', snapshot.result, x => x.research.data.rivals.data.competitors[0].sourceIds = ['missing'], checkResponse);
rejects('incorrect math', snapshot.result, x => x.testResults.data.scenarios[0].metrics.monthlyProfit = 999, checkResponse);
rejects('duplicate event sequence', events, x => x[3].sequence = 3, checkEvents);
rejects('incorrect parent', events, x => x[4].payload.step.parentStepId = null, checkEvents);
rejects('incorrect progress', events, x => x[8].progress.settledSteps = 10, checkEvents);
rejects('early final event', events, x => x.splice(2, x.length - 3), checkEvents);
rejects('invalid step output type', events, x => x[8].payload.step.output = snapshot.result.evaluation, checkEvents);
console.log(`PASS: all schemas compiled; 8 JSON fixtures; ${events.length} success-path and ${failureEvents.length} failure-path events; SSE parity; memory and simulation invariants; ${rejected} invalid cases rejected.`);
