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
test("explanation is built from the run's numbers and names strategies by their mix", () => {
  const { explainCampaign } = require("../src/campaign/explain.cjs");
  const input = mockCampaignInput({
    business: { name: "X", description: "d", audience: "a", region: "Türkiye" },
  });
  const metrics = (p10, mean, p90) => ({
    expected_purchases: 80,
    expected_contribution_profit: mean,
    profit_p10: p10,
    profit_p90: p90,
    profit_stddev: 10,
    probability_of_loss: 0.1,
  });
  const strategy = (id, social, search, influencer, creative) => ({
    strategy_id: id,
    creative,
    initial_allocation: {
      paid_social: social,
      paid_search: search,
      influencer,
    },
    adaptation: { max_reallocation_fraction: 0.2 },
  });
  const results = [
    {
      strategy: strategy("a", 0.1, 0.1, 0.8, "discovery"),
      adaptive: metrics(-500, 100, 900),
    },
    {
      strategy: strategy("b", 0.2, 0.6, 0.2, "proof"),
      adaptive: metrics(200, 150, 400),
    },
  ];
  const rec = (r, profile) => ({
    profile,
    strategy: r.strategy,
    metrics: r.adaptive,
    paired_profit_delta: { mean: 50 },
  });
  const x = explainCampaign({
    input,
    evaluation: { scenario_count: 40, results },
    ui: {
      recommendations: [
        rec(results[1], "conservative"),
        rec(results[0], "high_risk_high_reward"),
      ],
    },
    research: null,
    audit: { approved: 2, rejected: [] },
  });
  assert.equal(
    x.recommendations[0].title,
    "Arama reklamı ağırlıklı · Kanıt/yorum",
  );
  assert.equal(x.recommendations[1].title, "Influencer ağırlıklı · Keşif");
  assert.match(x.recommendations[0].steps[0], /2 aday içinde 1\. sırada/);
  assert.match(x.process[2], /deterministik örneklemedir/);
  assert.equal(x.channels.length, 3);
});
