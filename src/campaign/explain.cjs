// Explains how the recommendations were produced, using only numbers from the run.
// The strategies come from deterministic sampling and simulation, not a language model,
// so this is a computed reasoning trail rather than model "thoughts".
const CHANNELS = ["paid_social", "paid_search", "influencer"];
const CHANNEL = {
  paid_social: "Sosyal medya",
  paid_search: "Arama reklamı",
  influencer: "Influencer",
};
const CREATIVE = {
  proof: ["Kanıt/yorum", 1],
  discovery: ["Keşif", 1.08],
  offer: ["Teklif", 1.03],
};
const PROFILE = {
  conservative: {
    label: "Temkinli",
    rule: "kötü senaryolardaki kârı (P10) en yüksek olan aday seçilir",
    score: (m) => m.profit_p10,
    scoreName: "P10 kârı",
  },
  balanced: {
    label: "Dengeli",
    rule: "beklenen kâr − 0,5 × kâr oynaklığı en yüksek olan aday seçilir",
    score: (m) => m.expected_contribution_profit - 0.5 * m.profit_stddev,
    scoreName: "risk ayarlı kâr",
  },
  high_risk_high_reward: {
    label: "Yüksek risk / getiri",
    rule: "iyi senaryolardaki kârı (P90) en yüksek olan aday seçilir",
    score: (m) => m.profit_p90,
    scoreName: "P90 kârı",
  },
};
const fmt = (n) =>
  Math.round(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const pct = (n) =>
  `%${(n * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
function dominant(allocation) {
  return [...CHANNELS].sort((a, b) => allocation[b] - allocation[a])[0];
}
function displayName(strategy) {
  const top = dominant(strategy.initial_allocation);
  const mix =
    strategy.initial_allocation[top] < 0.4
      ? "Dengeli dağılım"
      : `${CHANNEL[top]} ağırlıklı`;
  return `${mix} · ${CREATIVE[strategy.creative]?.[0] || strategy.creative}`;
}
// Cost per purchase before saturation and fatigue: CPC / conversion rate.
function channelEconomics(input) {
  return Object.fromEntries(
    CHANNELS.map((c) => {
      const a = input.channels[c];
      return [
        c,
        {
          costPerPurchase: a.cost_per_click / a.conversion_rate,
          delay: a.conversion_delay_days,
          uncertainty: a.cost_relative_sd + a.conversion_relative_sd,
          saturation: a.daily_saturation_spend,
        },
      ];
    }),
  );
}
function channelFacts(input, econ) {
  const cur = input.currency;
  const byCost = [...CHANNELS].sort(
    (a, b) => econ[a].costPerPurchase - econ[b].costPerPurchase,
  );
  const riskiest = [...CHANNELS].sort(
    (a, b) => econ[b].uncertainty - econ[a].uncertainty,
  )[0];
  return CHANNELS.map((c) => {
    const e = econ[c],
      a = input.channels[c];
    const notes = [];
    if (c === byCost[0]) notes.push("satış başı en ucuz kanal");
    if (c === byCost.at(-1)) notes.push("satış başı en pahalı kanal");
    if (c === riskiest) notes.push("sonucu en belirsiz kanal");
    if (e.delay >= 5) notes.push(`satışlar ${e.delay} gün gecikiyor`);
    return `${CHANNEL[c]}: tıklama ${fmt(a.cost_per_click)} ${cur}, dönüşüm ${pct(a.conversion_rate)} → satış başı ≈${fmt(e.costPerPurchase)} ${cur}; günlük ${fmt(e.saturation)} ${cur} üstünde verim düşer${notes.length ? ` (${notes.join(", ")})` : ""}.`;
  });
}
function explainRecommendation(rec, all, input, econ, others) {
  const p = PROFILE[rec.profile];
  const m = rec.metrics,
    s = rec.strategy,
    cur = input.currency;
  const scores = all.map((r) => p.score(r.adaptive));
  const mine = p.score(m);
  const rank = scores.filter((x) => x > mine).length + 1;
  const top = dominant(s.initial_allocation);
  const [creativeLabel, creativeFactor] = CREATIVE[s.creative] || [
    s.creative,
    1,
  ];
  const share = s.initial_allocation[top];
  const steps = [];
  steps.push(
    `Kural: ${p.label} profilde ${p.rule}. Bu aday ${all.length} aday içinde ${rank}. sırada (${p.scoreName}: ${fmt(mine)} ${cur}; adayların medyanı ${fmt(median(scores))} ${cur}).`,
  );
  const why = [];
  const cheapest = [...CHANNELS].sort(
    (a, b) => econ[a].costPerPurchase - econ[b].costPerPurchase,
  )[0];
  if (top === cheapest) why.push("varsayımlarda satış başı en ucuz kanal");
  if (econ[top].delay >= 5)
    why.push(`satışları ${econ[top].delay} gün gecikerek geliyor`);
  if (econ[top].uncertainty >= 1)
    why.push("sonucu belirsiz, iyi senaryolarda yükselir");
  steps.push(
    `Dağılım: en büyük pay ${CHANNEL[top]} kanalında (bütçenin ${pct(share)} kadarı)${why.length ? ` (${why.join("; ")})` : ""}. Diğerleri: ${CHANNELS.filter(
      (c) => c !== top,
    )
      .map((c) => `${CHANNEL[c]} ${pct(s.initial_allocation[c])}`)
      .join(", ")}. Her kanalda en az %10 bırakılır ki veri toplanabilsin.`,
  );
  steps.push(
    `Kreatif: ${creativeLabel} (modelde dönüşüm çarpanı ×${creativeFactor.toLocaleString("tr-TR")}; kalibre edilmemiş varsayım).`,
  );
  steps.push(
    `Uyarlama: her 3 günde, yeterli veri varsa en verimsiz kanaldan en verimliye kalan bütçenin en fazla ${pct(s.adaptation.max_reallocation_fraction)} kadarı kaydırılır. 40 senaryoda bu, sabit dağılıma göre ortalama ${rec.paired_profit_delta.mean >= 0 ? "+" : ""}${fmt(rec.paired_profit_delta.mean)} ${cur} kâr farkı yarattı.`,
  );
  steps.push(
    `Sonuç: ${fmt(input.budget)} ${cur} harcamayla ortalama ${fmt(m.expected_purchases)} satış ve ${fmt(m.expected_contribution_profit)} ${cur} kâr; senaryoların %80'i ${fmt(m.profit_p10)} ile ${fmt(m.profit_p90)} ${cur} arasında. Zarar eden senaryo oranı: ${pct(m.probability_of_loss)}.`,
  );
  const cmp = others
    .filter((o) => o !== rec)
    .map((o) => {
      const d =
        m.expected_contribution_profit - o.metrics.expected_contribution_profit;
      const r = m.probability_of_loss - o.metrics.probability_of_loss;
      return `${PROFILE[o.profile].label}'ye göre beklenen kâr ${d >= 0 ? "+" : ""}${fmt(d)} ${cur}, zarar olasılığı ${r >= 0 ? "+" : ""}${(r * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} puan`;
    });
  if (cmp.length) steps.push(`Karşılaştırma: ${cmp.join("; ")}.`);
  return { strategyId: s.strategy_id, title: displayName(s), steps };
}
function explainCampaign({ input, evaluation, ui, research, audit }) {
  const econ = channelEconomics(input);
  const recs = ui.recommendations;
  const process = [
    `Girdi: ${fmt(input.budget)} ${input.currency} bütçe, 30 gün, satış başı katkı ${fmt(input.unit_contribution)} ${input.currency}. Kanal rakamları ${input.data_provenance === "synthetic" ? "mock (sentetik) varsayımdır" : "ölçülmüş veridir"}.`,
    research?.competitors?.length
      ? `Rakip araştırması (${research.provider === "gemini" ? "Gemini" : "katalog"}) stratejiye bağlam olarak eklendi; simülasyon rakamlarını değiştirmez.`
      : "Rakip araştırması sonuç vermedi; strateji yalnız kampanya girdisiyle üretildi.",
    `Aday üretimi: ${audit.approved + audit.rejected.length} kanal karışımı üretildi (4'ü sabit uç örnek: tek kanala %80 veya eşit dağılım; kalanı rastgele ama her kanala en az %10). Kreatif tipleri sırayla Kanıt, Keşif, Teklif. Bu adım yapay zekâ değil, deterministik örneklemedir.`,
    `Denetim: Orchestrator ${audit.approved} adayı onayladı, ${audit.rejected.length} adayı reddetti (bütçe, kapsam, kanal payları, tekrar kontrolü).`,
    `Simülasyon: her aday ${evaluation.scenario_count} farklı piyasa senaryosunda gün gün 30 gün oynatıldı; maliyet ve dönüşüm her senaryoda rastgele sapar, doyma ve reklam yorgunluğu uygulanır. Her aday hem uyarlamalı hem sabit bütçeyle denendi.`,
    `Seçim: üç farklı risk profili için en iyi aday seçildi; öneriler birbirinden bütçenin en az %15'i kadar farklı olmak zorunda.`,
  ];
  return {
    process,
    channels: channelFacts(input, econ),
    recommendations: recs.map((r) =>
      explainRecommendation(r, evaluation.results, input, econ, recs),
    ),
  };
}
module.exports = { explainCampaign, displayName };
