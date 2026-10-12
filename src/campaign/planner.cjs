// Strategic plans: each candidate is a purpose + thesis + 30-day timeline + channel tactics +
// success criteria, written before simulation. Codex writes them; templates are the fallback.
// The simulation tests only what it models: channel shares, creative and the 3-day shift rule.
const { runCli } = require("../runtime/cli.cjs");
const { AppError } = require("../runtime/core.cjs");
const CHANNELS = ["paid_social", "paid_search", "influencer"];
const CREATIVES = ["proof", "discovery", "offer"];
const FLOOR = 0.1;
const str = { type: "string" };
const strList = { type: "array", items: str };
const planShape = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "purpose",
    "thesis",
    "allocation",
    "creative",
    "key_message",
    "channel_tactics",
    "timeline",
    "success_criteria",
    "risks",
  ],
  properties: {
    name: str,
    purpose: str,
    thesis: str,
    allocation: {
      type: "object",
      additionalProperties: false,
      required: CHANNELS,
      properties: Object.fromEntries(
        CHANNELS.map((c) => [c, { type: "number" }]),
      ),
    },
    creative: { type: "string", enum: CREATIVES },
    key_message: str,
    channel_tactics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["channel", "role", "tactics"],
        properties: {
          channel: { type: "string", enum: CHANNELS },
          role: str,
          tactics: strList,
        },
      },
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "start_day",
          "end_day",
          "phase",
          "goal",
          "actions",
          "checkpoint",
        ],
        properties: {
          start_day: { type: "integer" },
          end_day: { type: "integer" },
          phase: str,
          goal: str,
          actions: strList,
          checkpoint: str,
        },
      },
    },
    success_criteria: {
      type: "object",
      additionalProperties: false,
      required: [
        "max_cost_per_purchase",
        "max_loss_probability",
        "min_purchases",
      ],
      properties: {
        max_cost_per_purchase: { type: "number" },
        max_loss_probability: { type: "number" },
        min_purchases: { type: "number" },
      },
    },
    risks: strList,
  },
};
const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["situation", "plans"],
  properties: {
    situation: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "market", "competition", "key_facts"],
      properties: {
        summary: str,
        market: str,
        competition: str,
        key_facts: strList,
      },
    },
    plans: { type: "array", items: planShape },
  },
};
const fmt = (n) => Math.round(n).toLocaleString("tr-TR");
const text = (v, max, fallback = "") =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
const list = (v, max, n) =>
  (Array.isArray(v) ? v : [])
    .map((x) => text(x, max))
    .filter(Boolean)
    .slice(0, n);
// Shares as fractions: every channel keeps the exploration floor and the total is exactly 1.
function normalizeAllocation(raw) {
  const v = CHANNELS.map((c) => Math.max(0, Number(raw?.[c]) || 0));
  const total = v.reduce((a, b) => a + b, 0) || 1;
  let shares = v.map((x) => x / total);
  for (let i = 0; i < 3; i++) {
    const low = shares.map((x) => x < FLOOR);
    const rest = 1 - FLOOR * low.filter(Boolean).length;
    const free = shares.reduce((a, x, j) => a + (low[j] ? 0 : x), 0) || 1;
    shares = shares.map((x, j) => (low[j] ? FLOOR : (x / free) * rest));
  }
  const rounded = shares.map((x) => Math.round(x * 10000) / 10000);
  rounded[rounded.indexOf(Math.max(...rounded))] +=
    1 - rounded.reduce((a, b) => a + b, 0);
  return Object.fromEntries(CHANNELS.map((c, i) => [c, rounded[i]]));
}
function cleanPlan(p, i) {
  const timeline = (Array.isArray(p.timeline) ? p.timeline : [])
    .map((t) => ({
      start_day: Math.min(
        30,
        Math.max(1, Math.round(Number(t.start_day) || 1)),
      ),
      end_day: Math.min(30, Math.max(1, Math.round(Number(t.end_day) || 30))),
      phase: text(t.phase, 80, "Aşama"),
      goal: text(t.goal, 300),
      actions: list(t.actions, 300, 6),
      checkpoint: text(t.checkpoint, 300),
    }))
    .filter((t) => t.end_day >= t.start_day)
    .sort((a, b) => a.start_day - b.start_day)
    .slice(0, 8);
  const c = p.success_criteria || {};
  return {
    id: `plan-${i + 1}`,
    name: text(p.name, 80, `Plan ${i + 1}`),
    purpose: text(p.purpose, 400),
    thesis: text(p.thesis, 600),
    allocation: normalizeAllocation(p.allocation),
    creative: CREATIVES.includes(p.creative) ? p.creative : "proof",
    key_message: text(p.key_message, 300),
    channel_tactics: (Array.isArray(p.channel_tactics) ? p.channel_tactics : [])
      .filter((t) => CHANNELS.includes(t.channel))
      .map((t) => ({
        channel: t.channel,
        role: text(t.role, 200),
        tactics: list(t.tactics, 300, 5),
      })),
    timeline,
    success_criteria: {
      max_cost_per_purchase:
        Math.max(0, Number(c.max_cost_per_purchase) || 0) || null,
      max_loss_probability:
        Math.min(1, Math.max(0, Number(c.max_loss_probability) || 0)) || null,
      min_purchases:
        Math.max(0, Math.round(Number(c.min_purchases) || 0)) || null,
    },
    risks: list(p.risks, 300, 4),
  };
}
// Turns a plan into a simulation candidate under the same invariants as generated strategies.
function toStrategy(plan, input, runId) {
  return {
    strategy_id: `str-${runId.replace(/[^A-Za-z0-9]/g, "").slice(-24)}-${plan.id}`,
    revision: 1,
    run_id: runId,
    business_id: input.business_id,
    product_id: input.product_id,
    name: plan.name,
    generator: "orchestrator_supplied",
    budget: input.budget,
    currency: input.currency,
    objective: "purchases",
    audience: input.audience,
    region: input.region,
    start_day: 1,
    end_day: 30,
    initial_allocation: plan.allocation,
    creative: plan.creative,
    assumptions: [
      ...input.assumptions,
      "Plan Orchestrator tarafından yazıldı; simülasyon yalnız kanal paylarını, kreatifi ve 3 günlük kaydırma kuralını test eder, takvim ve taktikleri değil.",
    ].slice(0, 40),
    adaptation: {
      enabled: true,
      checkpoint_days: 3,
      max_reallocation_fraction: 0.2,
      min_clicks_per_channel: 30,
      min_purchases_per_channel: 3,
      exploration_floor: FLOOR,
    },
  };
}
function brief({ business, input, research, history }) {
  const ch = CHANNELS.map((c) => {
    const a = input.channels[c];
    return `- ${c}: tıklama ${a.cost_per_click} ${input.currency}, dönüşüm %${(a.conversion_rate * 100).toFixed(1)}, satış başı ≈${fmt(a.cost_per_click / a.conversion_rate)} ${input.currency}, satış gecikmesi ${a.conversion_delay_days} gün, günlük doyma ${fmt(a.daily_saturation_spend)} ${input.currency}`;
  }).join("\n");
  const comp = research?.competitors?.length
    ? research.competitors.map((c) => `- ${c.name}: ${c.summary}`).join("\n")
    : "- Rakip bilgisi yok.";
  return `İşletme: ${business.name}${business.productName ? ` / ${business.productName}` : ""}
Ne yapıyor: ${business.description}
Hedef kitle: ${business.audience}
Pazar: ${business.region}
Bütçe: ${fmt(input.budget)} ${input.currency}, 30 gün. Satış başı katkı payı: ${fmt(input.unit_contribution)} ${input.currency}.
Kanal varsayımları (mock):
${ch}
Pazar özeti (araştırma): ${research?.summary || "yok"}
Rakipler:
${comp}
Geçmiş seçilmiş kampanya sayısı: ${history?.records?.length || 0}
Varsayımlar: ${input.assumptions.join(" ")}`;
}
function prompt(ctx) {
  const { input } = ctx;
  return `Sen bir performans pazarlama stratejistisin. Aşağıdaki işletme için 30 günlük reklam kampanyası planları yaz.

${brief(ctx)}

Kurallar:
- Önce "situation": işletmenin durumunu, pazarı ve rekabeti kısa ve somut özetle; key_facts en önemli 3-5 veri (rakamlarla).
- Sonra 4 veya 5 birbirinden gerçekten farklı plan yaz. Her plan bir amaçla başlar (ör. hazır talebi yakalamak, bilinirlik yaratıp güven kazanmak, teklifle hızlı deneme).
- thesis: bu planın neden işe yarayacağına dair somut gerekçe; kanal rakamlarına ve rakiplere dayan.
- allocation: üç kanalın yüzde payı; her biri en az 10, toplam 100. Planlar arasında paylar en az 15 puan farklı olsun.
- creative: proof (kanıt/müşteri yorumu), discovery (keşif/bilinirlik) veya offer (teklif/indirim).
- channel_tactics: her kanal için rolü ve 2-4 somut taktik (hedefleme, reklam formatı, mesaj, teklif; mümkünse rakiplerden farkı kullan).
- timeline: 1-30. günleri boşluksuz kapsayan 3-5 aşama; her aşamada hedef, 2-4 somut eylem ve bir kontrol noktası (hangi metriğe bakılır, ne olursa ne yapılır).
- Simülasyon her 3 günde bir, en verimsiz kanaldan en verimliye kalan bütçenin en fazla %20'sini kaydırır; kontrol noktalarını buna uygun yaz.
- success_criteria: max_cost_per_purchase (${input.currency}; kâr için ${fmt(input.unit_contribution)} altında olmalı), max_loss_probability (0-1), min_purchases (30 günde).
- risks: 2-3 somut risk.
- Bilmediğin bilgiyi uydurma; rakamları yukarıdaki varsayımlardan türet. Tüm metinler Türkçe.`;
}
// Deterministic fallback: four archetypes with generic but complete timelines.
function templatePlans(input) {
  const cur = input.currency;
  const cpp = (c) =>
    input.channels[c].cost_per_click / input.channels[c].conversion_rate;
  const target = Math.round(
    Math.min(
      input.unit_contribution * 0.8,
      Math.max(...CHANNELS.map(cpp)) * 1.2,
    ),
  );
  const base = (budgetShare) =>
    Math.round((input.budget * budgetShare) / target);
  const phases = (focus) => [
    {
      start_day: 1,
      end_day: 6,
      phase: "Test",
      goal: `Üç kanalda ilk veriyi topla; ${focus}`,
      actions: [
        "Her kanalda 2-3 reklam varyasyonu yayınla",
        "Dönüşüm takibini doğrula",
      ],
      checkpoint: "6. gün: satış başı maliyeti kanallara göre karşılaştır.",
    },
    {
      start_day: 7,
      end_day: 18,
      phase: "Optimize",
      goal: "Bütçeyi verimli kanala kaydır",
      actions: [
        "Zayıf reklamları kapat",
        "Kazanan mesajı diğer kanallara taşı",
      ],
      checkpoint: `Satış başı maliyet ${fmt(target)} ${cur} üstündeyse o kanalın payını azalt.`,
    },
    {
      start_day: 19,
      end_day: 30,
      phase: "Ölçekle",
      goal: "Kazanan kombinasyonu büyüt",
      actions: [
        "Bütçeyi kazanan kanalda artır",
        "Geri kazanma için yeniden hedefleme ekle",
      ],
      checkpoint: "Son 3 günde zarar varsa harcamayı kıs.",
    },
  ];
  return [
    {
      name: "Hazır talebi yakala",
      purpose: "Zaten çözüm arayanları satışa çevirmek",
      thesis: `Arama reklamının dönüşümü en yüksek (%${(input.channels.paid_search.conversion_rate * 100).toFixed(1)}); talep hazırsa en hızlı satış buradan gelir.`,
      allocation: { paid_social: 25, paid_search: 60, influencer: 15 },
      creative: "proof",
      key_message: "Neden bizi seçmelisiniz: kanıt ve müşteri yorumları",
      focus: "arama terimlerini netleştir",
    },
    {
      name: "Bilinirlik ve güven",
      purpose: "Markayı tanıtıp güven kazanmak",
      thesis:
        "Influencer ucuz tıklama getirir ama satışlar gecikir; bilinirlik uzun vadede maliyeti düşürür.",
      allocation: { paid_social: 25, paid_search: 15, influencer: 60 },
      creative: "discovery",
      key_message: "Ürünü keşfettir: nasıl çalıştığını göster",
      focus: "hangi içerik üreticisinin tuttuğunu gör",
    },
    {
      name: "Teklifle hızlı deneme",
      purpose: "İndirim/teklifle ilk denemeyi hızlandırmak",
      thesis:
        "Sosyal medyada geniş kitleye teklif, hızlı geri bildirim ve deneme sağlar.",
      allocation: { paid_social: 60, paid_search: 25, influencer: 15 },
      creative: "offer",
      key_message: "Sınırlı süreli başlangıç teklifi",
      focus: "teklif tutuyor mu ölç",
    },
    {
      name: "Dengeli test ve ölçek",
      purpose: "Riski dağıtıp kazanan kanalı veriyle bulmak",
      thesis:
        "Kanal performansı belirsiz; eşit başlayıp 3 günlük kurala göre kaydırmak riski azaltır.",
      allocation: { paid_social: 34, paid_search: 33, influencer: 33 },
      creative: "proof",
      key_message: "Kanıt odaklı tek mesaj, üç kanalda",
      focus: "kanalları eşit koşulda karşılaştır",
    },
  ].map((p, i) =>
    cleanPlan(
      {
        ...p,
        channel_tactics: CHANNELS.map((c) => ({
          channel: c,
          role: `Payı %${p.allocation[c]}`,
          tactics: ["Hedef kitleye göre segment", "2-3 kreatif varyasyonu"],
        })),
        timeline: phases(p.focus),
        success_criteria: {
          max_cost_per_purchase: target,
          max_loss_probability: 0.2,
          min_purchases: base(1),
        },
        risks: ["Mock kanal varsayımları gerçek pazarı yansıtmayabilir."],
      },
      i,
    ),
  );
}
function codexPlanner({
  runner = runCli,
  timeoutMs = 300000,
  effort = process.env.CODEX_PLAN_EFFORT || "low",
} = {}) {
  return {
    name: "codex",
    async plan(ctx) {
      const out = await runner({
        role: "campaign-planner",
        text: prompt(ctx),
        outputSchema,
        timeoutMs,
        effort,
      });
      const plans = (out?.plans || []).slice(0, 5).map(cleanPlan);
      if (plans.length < 2)
        throw new AppError("INVALID_OUTPUT", "Codex yeterli plan yazmadı.");
      const s = out.situation || {};
      return {
        provider: "codex",
        situation: {
          summary: text(s.summary, 800),
          market: text(s.market, 600),
          competition: text(s.competition, 600),
          key_facts: list(s.key_facts, 300, 6),
        },
        plans,
      };
    },
  };
}
function templatePlanner() {
  return {
    name: "template",
    async plan({ business, input, research }) {
      return {
        provider: "template",
        situation: {
          summary: `${business.name}: ${business.description} Hedef kitle: ${business.audience}; pazar: ${business.region}.`,
          market: research?.summary || "Pazar özeti yok.",
          competition: research?.competitors?.length
            ? `Rakipler: ${research.competitors.map((c) => c.name).join(", ")}.`
            : "Rakip bilgisi yok.",
          key_facts: [
            `Bütçe ${fmt(input.budget)} ${input.currency}, satış başı katkı ${fmt(input.unit_contribution)} ${input.currency}.`,
          ],
        },
        plans: templatePlans(input),
      };
    },
  };
}
module.exports = {
  codexPlanner,
  templatePlanner,
  toStrategy,
  normalizeAllocation,
  cleanPlan,
  outputSchema,
};
