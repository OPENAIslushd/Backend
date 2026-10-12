"use strict";
const $ = (id) => document.getElementById(id);
const PROFILE = {
  conservative: "Temkinli",
  balanced: "Dengeli",
  high_risk_high_reward: "Yüksek risk / yüksek getiri",
};
const CHANNEL = {
  paid_social: "Sosyal medya",
  paid_search: "Arama reklamı",
  influencer: "Influencer",
};
const CREATIVE = {
  proof: "Kanıt / yorum",
  discovery: "Keşif",
  offer: "Teklif",
};
const ICON = { pending: "○", running: "◐", completed: "●", failed: "✕" };
let campaignId = null,
  pollTimer = null;
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs))
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  for (const c of children.flat(Infinity))
    if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
}
const fmt = (n, digits = 0) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("tr-TR", { maximumFractionDigits: digits });
const money = (n, cur) => `${fmt(n)} ${cur}`;
const pct = (n) => (n == null ? "—" : `%${fmt(n * 100, 1)}`);
function showError(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}
async function health() {
  try {
    const { services } = await api("/campaigns/health");
    $("health").replaceChildren(
      ...Object.entries(services).map(([name, state]) =>
        el("li", { class: state, title: state }, name),
      ),
    );
  } catch {
    $("health").replaceChildren(el("li", { class: "down" }, "orchestrator"));
  }
}
function renderSteps(c) {
  $("progress-card").hidden = false;
  $("steps").replaceChildren(
    ...c.steps.map((s) =>
      el(
        "li",
        { class: s.status },
        el("span", { class: "icon" }, ICON[s.status] || "○"),
        el("span", { class: "label" }, s.label),
        el("span", { class: "summary" }, s.summary || ""),
      ),
    ),
  );
}
function renderResearch(r) {
  if (!r) return;
  $("research-card").hidden = false;
  if (r.error) {
    $("research").replaceChildren(
      el("p", { class: "muted" }, `Araştırma yapılamadı: ${r.error.message}`),
    );
    return;
  }
  if (!r.competitors.length) {
    $("research").replaceChildren(
      el(
        "p",
        { class: "muted" },
        "Katalogda eşleşen rakip bulunamadı. Bu, rakip olmadığı anlamına gelmez; katalog şimdilik web analitiği, e-ticaret ve görev yönetimini kapsıyor.",
      ),
    );
    return;
  }
  $("research").replaceChildren(
    el(
      "div",
      { class: "competitors" },
      r.competitors.map((c) =>
        el(
          "article",
          { class: "competitor" },
          el("h3", {}, c.name),
          el(
            "ul",
            {},
            c.facts.map((f) =>
              el("li", {}, el("b", {}, f.dimension + ": "), f.statement),
            ),
          ),
          el(
            "p",
            { class: "muted small" },
            "Kaynak: ",
            c.sources.map((s, i) => [
              i ? ", " : "",
              el(
                "a",
                { href: s.url, target: "_blank", rel: "noopener" },
                s.title,
              ),
            ]),
          ),
        ),
      ),
    ),
  );
}
function allocation(a) {
  return el(
    "div",
    { class: "alloc" },
    Object.entries(CHANNEL).map(([k, label]) => {
      const bar = el("span", { class: "bar " + k });
      bar.style.width = `${a[k] * 100}%`;
      return el(
        "div",
        { class: "alloc-row" },
        el("span", { class: "alloc-label" }, label),
        el("span", { class: "track" }, bar),
        el("span", { class: "alloc-val" }, pct(a[k])),
      );
    }),
  );
}
function renderRecs(c) {
  const ui = c.recommendations;
  if (!ui) return;
  $("assumptions-card").hidden = false;
  $("assumptions").replaceChildren(
    ...[...c.input.assumptions, ...(ui.warnings || [])].map((a) =>
      el("li", {}, a),
    ),
  );
  $("recs-card").hidden = false;
  $("recs-note").textContent =
    `${c.audit.approved} strateji simüle edildi. Rakamlar mock varsayımlara dayanır; gerçek kampanya sonucu değildir.`;
  const selected = c.selection?.record.strategy;
  $("recs").replaceChildren(
    ...ui.recommendations.map((r) => {
      const m = r.metrics,
        cur = ui.currency;
      const isSelected =
        selected &&
        selected.strategy_id === r.strategy.strategy_id &&
        selected.revision === r.strategy.revision;
      return el(
        "article",
        { class: "rec" + (isSelected ? " selected" : "") },
        el("p", { class: "eyebrow" }, PROFILE[r.profile] || r.profile),
        el("h3", {}, r.strategy.name),
        el(
          "p",
          { class: "muted small" },
          `Kreatif: ${CREATIVE[r.strategy.creative] || r.strategy.creative}`,
        ),
        allocation(r.strategy.initial_allocation),
        el(
          "dl",
          { class: "metrics" },
          el("dt", {}, "Beklenen satış"),
          el("dd", {}, fmt(m.expected_purchases)),
          el("dt", {}, "Beklenen kâr"),
          el("dd", {}, money(m.expected_contribution_profit, cur)),
          el("dt", {}, "Kâr aralığı (P10–P90)"),
          el("dd", {}, `${fmt(m.profit_p10)} – ${fmt(m.profit_p90)}`),
          el("dt", {}, "ROI"),
          el("dd", {}, pct(m.roi)),
          el("dt", {}, "Müşteri edinme maliyeti"),
          el(
            "dd",
            {},
            m.acquisition_cost == null ? "—" : money(m.acquisition_cost, cur),
          ),
          el("dt", {}, "Zarar olasılığı"),
          el("dd", {}, pct(m.probability_of_loss)),
          el("dt", {}, "Uyarlamalı vs sabit"),
          el(
            "dd",
            {},
            `${r.paired_profit_delta?.mean >= 0 ? "+" : ""}${fmt(r.paired_profit_delta?.mean)} ${cur}`,
          ),
        ),
        el("p", { class: "small" }, r.reasons.join(" ")),
        el("p", { class: "muted small" }, r.tradeoffs[0]),
        c.status === "awaiting_selection"
          ? el(
              "button",
              { onclick: () => select(r.strategy) },
              "Bu stratejiyi seç",
            )
          : isSelected
            ? el("p", { class: "badge" }, "Seçildi")
            : null,
      );
    }),
  );
}
function renderSelection(c) {
  if (!c.selection) return;
  const rec = (c.observation || c.selection).record;
  $("selection-card").hidden = false;
  $("selection").replaceChildren(
    el(
      "p",
      {},
      `“${rec.strategy.name}” hafızaya kaydedildi (seçim ${rec.selection_id}, revizyon ${rec.record_revision}). Tahmin: ${fmt(rec.predicted.expected_purchases)} satış, ${money(rec.predicted.expected_contribution_profit, rec.input.currency)} kâr.`,
    ),
  );
  const cmp = rec.comparison;
  $("comparison").replaceChildren(
    cmp
      ? el(
          "dl",
          { class: "metrics" },
          el("dt", {}, "Karşılaştırılabilir mi"),
          el("dd", {}, cmp.comparable ? "Evet" : `Hayır — ${cmp.reason}`),
          el("dt", {}, "Satış farkı"),
          el("dd", {}, fmt(cmp.purchases_difference)),
          el("dt", {}, "Satış göreli hata"),
          el("dd", {}, pct(cmp.purchases_relative_error)),
          el("dt", {}, "Gerçek kâr"),
          el(
            "dd",
            {},
            money(cmp.actual_contribution_profit, rec.input.currency),
          ),
          el("dt", {}, "Kâr göreli hata"),
          el("dd", {}, pct(cmp.profit_relative_error)),
        )
      : "",
  );
}
function render(c) {
  renderSteps(c);
  renderResearch(c.research);
  renderRecs(c);
  renderSelection(c);
  const busy = c.status === "running" || c.status === "selecting";
  $("start").disabled = busy;
  $("start").textContent = busy ? "Çalışıyor…" : "Yeni analiz başlat";
  showError(c.error ? c.error.message : "");
}
async function poll() {
  clearTimeout(pollTimer);
  try {
    const c = await api(`/campaigns/${campaignId}`);
    render(c);
    if (c.status === "running" || c.status === "selecting")
      pollTimer = setTimeout(poll, 800);
  } catch (e) {
    showError(e.message);
  }
}
async function select(strategy) {
  showError("");
  try {
    await api(`/campaigns/${campaignId}/selection`, {
      method: "POST",
      body: JSON.stringify({
        strategyId: strategy.strategy_id,
        strategyRevision: strategy.revision,
      }),
    });
    poll();
  } catch (e) {
    showError(e.message);
  }
}
$("campaign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = new FormData(event.target);
  const v = (k) => String(f.get(k) || "").trim();
  const business = {
    name: v("name"),
    description: v("description"),
    audience: v("audience"),
    region: v("region"),
  };
  for (const k of ["productName", "topic", "url"]) if (v(k)) business[k] = v(k);
  const request = {
    clientRequestId: crypto.randomUUID(),
    dataMode: v("dataMode"),
    business,
  };
  if (v("budget")) request.budget = Number(v("budget"));
  if (v("currency")) request.currency = v("currency").toUpperCase();
  if (v("unitContribution"))
    request.unitContribution = Number(v("unitContribution"));
  for (const id of [
    "research-card",
    "assumptions-card",
    "recs-card",
    "selection-card",
  ])
    $(id).hidden = true;
  $("comparison").replaceChildren();
  showError("");
  try {
    const c = await api("/campaigns", {
      method: "POST",
      body: JSON.stringify(request),
    });
    campaignId = c.campaignId;
    history.replaceState(null, "", `/campaign#${campaignId}`);
    render(c);
    poll();
  } catch (e) {
    showError(e.message);
  }
});
$("actual-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = new FormData(event.target);
  try {
    const c = await api(`/campaigns/${campaignId}/actuals`, {
      method: "POST",
      body: JSON.stringify({
        spend: Number(f.get("spend")),
        purchases: Number(f.get("purchases")),
        source: String(f.get("source")).trim(),
      }),
    });
    render(c);
  } catch (e) {
    showError(e.message);
  }
});
$("example").addEventListener("click", () => {
  const form = $("campaign-form");
  const values = {
    name: "TakımPlan",
    productName: "TakımPlan Pro",
    description: "Küçük ekipler için görev ve proje yönetimi uygulaması.",
    audience: "10–50 kişilik ajans ve yazılım ekipleri",
    region: "Türkiye",
    topic: "Görev yönetimi",
  };
  for (const [k, val] of Object.entries(values)) form.elements[k].value = val;
});
health();
setInterval(health, 10000);
if (location.hash.length > 1) {
  campaignId = location.hash.slice(1);
  poll();
}
