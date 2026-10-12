const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAnswer } = require("../src/campaign/gemini.cjs");
const { researchChain } = require("../src/campaign/clients.cjs");
const { mockCampaignInput } = require("../src/campaign/mock-data.cjs");
test("Gemini answer: first JSON object is read, trailing page text is ignored, bad fields dropped", () => {
  const text = `{
"market_summary": "Pazar büyüyor {hızla}.",
"competitors": [
  {"name": "Çentik", "url": "https://centik.app", "summary": "QR damga kartı.", "strengths": ["NFC", 5], "pricing": null, "sources": ["https://centik.app", "javascript:alert(1)"]},
  {"name": "Adsız", "url": "ftp://x", "summary": ""}
]
}
Ritapos
+ 7`;
  const r = parseAnswer(text);
  assert.equal(r.summary, "Pazar büyüyor {hızla}.");
  assert.equal(r.competitors.length, 1);
  assert.deepEqual(r.competitors[0].strengths, ["NFC"]);
  assert.deepEqual(r.competitors[0].sources, ["https://centik.app"]);
  assert.throws(() => parseAnswer("Üzgünüm, yardımcı olamam."));
  assert.throws(() => parseAnswer('{"competitors": []}'));
});
test("research chain falls back to the next provider and records why", async () => {
  const chain = researchChain([
    {
      name: "gemini",
      research: async () => {
        throw new Error("doğrulama sayfası");
      },
    },
    {
      name: "catalog",
      research: async () => ({ provider: "catalog", competitors: [] }),
    },
  ]);
  const r = await chain.research({});
  assert.equal(r.provider, "catalog");
  assert.deepEqual(r.fallbackFrom, ["gemini: doğrulama sayfası"]);
  await assert.rejects(researchChain([]).research({}), {
    code: "TOOL_UNAVAILABLE",
  });
});
test("research reaches the strategy only as labelled context", () => {
  const input = mockCampaignInput(
    {
      business: {
        name: "Yakalıyo",
        description: "NFC sadakat",
        audience: "Kafeler",
        region: "Türkiye",
      },
    },
    {
      provider: "gemini",
      summary: "Rekabetçi pazar.",
      competitors: [{ name: "Çentik", summary: "QR damga kartı." }],
    },
  );
  assert.match(input.context, /Gemini özetidir; doğrulanmamıştır/);
  assert.match(input.context, /Çentik: QR damga kartı\./);
});
test("plans: shares keep the 10% floor and sum to 1; template plans cover all 30 days", () => {
  const {
    normalizeAllocation,
    templatePlanner,
    toStrategy,
  } = require("../src/campaign/planner.cjs");
  const a = normalizeAllocation({
    paid_social: 95,
    paid_search: 5,
    influencer: 0,
  });
  assert.ok(Object.values(a).every((x) => x >= 0.1));
  assert.ok(Math.abs(Object.values(a).reduce((x, y) => x + y, 0) - 1) < 1e-9);
  const input = mockCampaignInput({
    business: { name: "X", description: "d", audience: "a", region: "Türkiye" },
  });
  return templatePlanner()
    .plan({
      business: {
        name: "X",
        description: "d",
        audience: "a",
        region: "Türkiye",
      },
      input,
    })
    .then(({ plans }) => {
      for (const p of plans) {
        assert.equal(p.timeline[0].start_day, 1);
        assert.equal(p.timeline.at(-1).end_day, 30);
        const s = toStrategy(p, input, "campaign-abc");
        assert.equal(s.generator, "orchestrator_supplied");
        assert.match(s.strategy_id, /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
      }
    });
});
test("evidence checks each plan's own targets against its simulated metrics", () => {
  const { buildEvidence } = require("../src/campaign/explain.cjs");
  const plan = {
    id: "plan-1",
    strategyId: "s1",
    success_criteria: {
      max_cost_per_purchase: 600,
      max_loss_probability: 0.1,
      min_purchases: 90,
    },
  };
  const m = {
    acquisition_cost: 633,
    probability_of_loss: 0.05,
    expected_purchases: 79,
    expected_contribution_profit: 80000,
    profit_p10: 40000,
    profit_p90: 120000,
  };
  const [ev] = buildEvidence({
    plans: [plan],
    planEvaluation: {
      results: [
        {
          strategy: { strategy_id: "s1" },
          adaptive: m,
          paired_profit_delta: { mean: 3700 },
        },
      ],
    },
    baselineEvaluation: {
      results: [70000, 90000].map((p) => ({
        adaptive: { expected_contribution_profit: p, profit_p10: 30000 },
      })),
    },
    ui: {
      recommendations: [
        { profile: "conservative", strategy: { strategy_id: "s1" } },
      ],
    },
    input: { currency: "TRY" },
  });
  assert.deepEqual(
    ev.checks.map((c) => c.met),
    [false, true, false, true],
  );
  assert.equal(ev.verdict, "partial");
  assert.equal(ev.baseline.beatsProfit, 1);
  assert.equal(ev.recommendedAs.label, "Temkinli");
});
