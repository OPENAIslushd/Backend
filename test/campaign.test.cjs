const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  CampaignService,
  auditStrategies,
} = require("../src/campaign/service.cjs");
const { mockCampaignInput } = require("../src/campaign/mock-data.cjs");
const { AppError } = require("../src/runtime/core.cjs");
const { setup } = require("./helpers.cjs");
const start = (extra = {}) => ({
  clientRequestId: randomUUID(),
  dataMode: "mock",
  business: {
    name: "TakımPlan",
    description: "Küçük ekipler için görev yönetimi",
    audience: "Küçük ekipler",
    region: "Türkiye",
  },
  ...extra,
});
const strategy = (input, runId, i, allocation) => ({
  strategy_id: `str-${i}`,
  revision: 1,
  run_id: runId,
  business_id: input.business_id,
  product_id: input.product_id,
  budget: input.budget,
  currency: input.currency,
  initial_allocation: allocation || {
    paid_social: 0.4,
    paid_search: 0.4,
    influencer: 0.2,
  },
  adaptation: { exploration_floor: 0.1 },
});
// Fake services follow the action contract shapes the Orchestrator reads; no real simulation.
function fakeSimulation({ bad = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async health() {
      return { memory: "ok", strategy: "ok", simulation: "ok", outcome: "ok" };
    },
    async call(action, payload, runId) {
      calls.push({ action, payload, runId });
      if (action === "memory.retrieve") return { records: [] };
      if (action === "strategy.generate")
        return {
          strategies: [
            ...[1, 2, 3].map((i) => strategy(payload.input, runId, i)),
            ...Array.from({ length: bad }, (_, i) =>
              strategy(payload.input, runId, 10 + i, {
                paid_social: 0.9,
                paid_search: 0.05,
                influencer: 0.05,
              }),
            ),
          ],
        };
      if (action === "simulation.evaluate")
        return {
          run_id: runId,
          scenario_count: payload.scenario_count,
          results: payload.strategies.map((strategy) => ({ strategy })),
        };
      if (action === "outcome.prepare")
        return {
          status: "complete",
          currency: "TRY",
          warnings: [],
          recommendations: payload.evaluation.results.map((r, i) => ({
            profile: ["conservative", "balanced", "high_risk_high_reward"][i],
            strategy: r.strategy,
          })),
        };
      if (action === "outcome.select") {
        const s = payload.evaluation.results.find(
          (r) => r.strategy.strategy_id === payload.strategy_id,
        ).strategy;
        return {
          proposed_action: "memory.save_selection",
          payload: {
            idempotency_key: "k",
            record: { strategy: s, record_revision: 1 },
          },
        };
      }
      if (action === "memory.save_selection") return { record: payload.record };
      throw new Error("unexpected " + action);
    },
  };
}
const research = {
  research: async () => ({ competitors: [{ name: "Trello" }], warnings: [] }),
};
async function service(t, options = {}) {
  const c = await setup(t);
  const s = new CampaignService(c.store, {
    simulation: fakeSimulation(options),
    research: options.research || research,
  });
  t.after(() => s.idle());
  return { ...c, campaigns: s };
}
test("campaign pipeline reaches awaiting_selection, then selection is saved to memory", async (t) => {
  const { campaigns } = await service(t);
  const c = await campaigns.start(start());
  await campaigns.idle();
  let done = await campaigns.get(c.campaignId);
  assert.equal(done.status, "awaiting_selection");
  assert.ok(done.steps.every((s) => s.status === "completed"));
  assert.equal(done.recommendations.recommendations.length, 3);
  assert.equal(done.input.currency, "TRY");
  assert.equal(done.input.data_provenance, "synthetic");
  await campaigns.select(c.campaignId, {
    strategyId: "str-2",
    strategyRevision: 1,
  });
  await campaigns.idle();
  done = await campaigns.get(c.campaignId);
  assert.equal(done.status, "completed");
  assert.equal(done.selection.record.strategy.strategy_id, "str-2");
  assert.deepEqual(
    await campaigns.select(c.campaignId, {
      strategyId: "str-2",
      strategyRevision: 1,
    }),
    done,
  );
  await assert.rejects(
    campaigns.select(c.campaignId, {
      strategyId: "str-1",
      strategyRevision: 1,
    }),
    {
      code: "IDEMPOTENCY_CONFLICT",
    },
  );
});
test("Orchestrator audit rejects inconsistent candidates before simulation", async (t) => {
  const { campaigns } = await service(t, { bad: 2 });
  const c = await campaigns.start(start());
  await campaigns.idle();
  const done = await campaigns.get(c.campaignId);
  assert.equal(done.audit.approved, 3);
  assert.equal(done.audit.rejected.length, 2);
  const sim = campaigns.simulation.calls.find(
    (x) => x.action === "simulation.evaluate",
  );
  assert.equal(sim.payload.strategies.length, 3);
});
test("research failure does not block the simulation", async (t) => {
  const { campaigns } = await service(t, {
    research: {
      research: async () => {
        throw new AppError("TOOL_UNAVAILABLE", "python yok", 502, true);
      },
    },
  });
  const c = await campaigns.start(start());
  await campaigns.idle();
  const done = await campaigns.get(c.campaignId);
  assert.equal(done.steps[0].status, "failed");
  assert.equal(done.status, "awaiting_selection");
});
test("invalid, real-mode and duplicate campaign requests", async (t) => {
  const { campaigns } = await service(t);
  await assert.rejects(campaigns.start({ ...start(), business: {} }), {
    code: "INVALID_REQUEST",
  });
  await assert.rejects(campaigns.start(start({ dataMode: "real" })), {
    code: "TOOL_UNAVAILABLE",
  });
  const req = start();
  const a = await campaigns.start(req);
  await campaigns.idle();
  assert.equal((await campaigns.start(req)).campaignId, a.campaignId);
  await assert.rejects(campaigns.start({ ...req, budget: 5 }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
});
test("mock input keeps user values and labels every filled default", () => {
  const given = mockCampaignInput(
    start({ budget: 5000, currency: "EUR", unitContribution: 20 }),
  );
  assert.equal(given.budget, 5000);
  assert.equal(given.unit_contribution, 20);
  assert.equal(given.assumptions.length, 1);
  const filled = mockCampaignInput(start());
  assert.equal(filled.currency, "TRY");
  assert.equal(filled.assumptions.length, 4);
  assert.equal(filled.business_id, "takimplan");
  const { rejected } = auditStrategies(
    [strategy(filled, "other-run", 1)],
    filled,
    "run",
  );
  assert.equal(rejected[0].reason, "run_id uyuşmuyor");
});
