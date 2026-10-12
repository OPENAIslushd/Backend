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
