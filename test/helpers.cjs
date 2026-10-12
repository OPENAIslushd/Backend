const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Store } = require("../src/runtime/store.cjs");
const { IntakeService } = require("../src/intake/service.cjs");
const { Orchestrator } = require("../src/orchestrator/service.cjs");
const { demoAdapters } = require("../src/adapters/demo.cjs");
const version = "4.0.0";
const fixture = require("../contracts/examples/intake.create.request.json");
async function setup(t, overrides = {}, runtime = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slushd-test-"));
  const store = new Store(dir);
  await store.init();
  const intakes = new IntakeService(store);
  const adapters = { ...demoAdapters(store), ...overrides };
  const orchestrator = new Orchestrator(store, intakes, adapters, {
    timeoutMs: 100,
    phaseTimeoutMs: 2000,
    ...runtime,
  });
  t.after(async () => {
    await orchestrator.idle();
    await store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, store, intakes, adapters, orchestrator };
}
const create = () => ({ ...fixture, clientRequestId: randomUUID() });
const message = (s, action = "continue_with_unknowns", text = null) => ({
  schemaVersion: version,
  clientMessageId: randomUUID(),
  expectedRevision: s.revision,
  action,
  message: text,
});
const analyze = (s) => ({
  schemaVersion: version,
  clientRequestId: randomUUID(),
  intakeId: s.intakeId,
  intakeRevision: s.revision,
});
const approve = (revision = 1, decision = "approve") => ({
  schemaVersion: version,
  clientRequestId: randomUUID(),
  reviewRevision: revision,
  decision,
});
async function ready(ctx) {
  const s = await ctx.intakes.create(create());
  return ctx.intakes.message(s.intakeId, message(s));
}
async function waiting(ctx) {
  const s = await ready(ctx);
  const accepted = await ctx.orchestrator.analyze(analyze(s));
  await ctx.orchestrator.idle();
  return accepted.runId;
}
async function complete(ctx) {
  const id = await waiting(ctx);
  await ctx.orchestrator.approve(id, approve());
  await ctx.orchestrator.idle();
  return ctx.orchestrator.get(id);
}
module.exports = {
  setup,
  create,
  message,
  analyze,
  approve,
  ready,
  waiting,
  complete,
};
