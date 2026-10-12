// Mock data mode: fills campaign inputs the user did not give with labelled synthetic values.
// Real data mode (docs/real-data-mode.tr.md) will replace these with researched company data.
const BASE_CHANNELS_USD = {
  paid_social: {
    cost_per_click: 1.2,
    conversion_rate: 0.055,
    daily_saturation_spend: 700,
    fatigue_per_day: 0.012,
    conversion_delay_days: 2,
    cost_relative_sd: 0.2,
    conversion_relative_sd: 0.35,
  },
  paid_search: {
    cost_per_click: 1.8,
    conversion_rate: 0.09,
    daily_saturation_spend: 450,
    fatigue_per_day: 0.004,
    conversion_delay_days: 1,
    cost_relative_sd: 0.12,
    conversion_relative_sd: 0.2,
  },
  influencer: {
    cost_per_click: 0.9,
    conversion_rate: 0.045,
    daily_saturation_spend: 1000,
    fatigue_per_day: 0.02,
    conversion_delay_days: 7,
    cost_relative_sd: 0.4,
    conversion_relative_sd: 0.8,
  },
};
// Rough price levels relative to USD; only scales money amounts in mock mode.
const PRICE_LEVEL = { USD: 1, EUR: 1, GBP: 1, TRY: 30 };
const TURKEY = /t[üu]rk|turkey|istanbul|ankara|izmir/i;
const round = (x) => Math.round(x * 100) / 100;
function slug(text, fallback) {
  const s = String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || fallback;
}
// Research findings reach the strategy service only as labelled free-text context.
function researchContext(research) {
  if (!research?.competitors?.length) return "";
  const label =
    research.provider === "gemini"
      ? "Rakip bilgileri Gemini özetidir; doğrulanmamıştır."
      : "Rakip bilgileri kayıtlı katalog özetidir.";
  const lines = research.competitors.map((c) => `- ${c.name}: ${c.summary}`);
  return [
    "",
    label,
    research.summary && `Pazar özeti: ${research.summary}`,
    "Rakipler:",
    ...lines,
  ]
    .filter((x) => x !== null && x !== undefined)
    .join("\n");
}
function mockCampaignInput(request, research = null) {
  const b = request.business;
  const assumptions = [
    "Mock veri modu: kanal maliyet ve dönüşüm rakamları sentetik varsayımdır, ölçülmüş kampanya verisi değildir.",
  ];
  const currency = request.currency || (TURKEY.test(b.region) ? "TRY" : "USD");
  if (!request.currency)
    assumptions.push(
      `Para birimi verilmedi; bölgeye göre ${currency} varsayıldı.`,
    );
  const level = PRICE_LEVEL[currency] ?? 1;
  if (!(currency in PRICE_LEVEL))
    assumptions.push(
      `${currency} için fiyat seviyesi bilinmiyor; kanal maliyetleri USD seviyesinde bırakıldı.`,
    );
  const budget = request.budget ?? round(12000 * level);
  if (request.budget == null)
    assumptions.push(
      `Reklam bütçesi verilmedi; 30 gün için ${budget} ${currency} varsayıldı.`,
    );
  const unit = request.unitContribution ?? round(55 * level);
  if (request.unitContribution == null)
    assumptions.push(
      `Satış başı katkı payı verilmedi; ${unit} ${currency} varsayıldı.`,
    );
  const channels = Object.fromEntries(
    Object.entries(BASE_CHANNELS_USD).map(([name, c]) => [
      name,
      {
        ...c,
        cost_per_click: round(c.cost_per_click * level),
        daily_saturation_spend: round(c.daily_saturation_spend * level),
      },
    ]),
  );
  const businessId = slug(b.name, "business");
  return {
    business_id: businessId,
    product_id: slug(b.productName || b.name, "product"),
    product_label: (b.productName || b.name).slice(0, 2000),
    audience: b.audience.slice(0, 2000),
    region: b.region.slice(0, 2000),
    objective: "purchases",
    budget,
    currency,
    duration_days: 30,
    unit_contribution: unit,
    data_provenance: "synthetic",
    assumptions,
    context: (`Ürün: ${b.description}` + researchContext(research)).slice(
      0,
      10000,
    ),
    channels,
  };
}
module.exports = { mockCampaignInput, slug };
