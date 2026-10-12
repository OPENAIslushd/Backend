"use strict";
const $ = (id) => document.getElementById(id);
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
// Running steps show elapsed time so slow research never looks frozen.
function elapsed(s) {
  if (s.status !== "running" || !s.startedAt) return "";
  const sec = Math.max(
    0,
    Math.round((Date.now() - Date.parse(s.startedAt)) / 1000),
  );
  return ` · ${sec} sn`;
}
function explanationFor(c, r) {
  return c.explanation?.recommendations.find(
    (x) => x.strategyId === r.strategy.strategy_id,
  );
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
        el("span", { class: "summary" }, (s.summary || "") + elapsed(s)),
      ),
    ),
  );
}
// Competitor cards from research (Gemini summary or catalog facts).
function researchBlock(r, cls) {
  if (!r) return null;
  if (r.error)
    return el(
      "p",
      { class: cls.note },
      `Araştırma yapılamadı: ${r.error.message}`,
    );
  if (!r.competitors.length)
    return el(
      "p",
      { class: cls.note },
      "Eşleşen rakip bulunamadı. Bu, rakip olmadığı anlamına gelmez.",
    );
  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u;
    }
  };
  return el(
    "div",
    { class: cls.wrap },
    el(
      "p",
      { class: cls.note },
      r.provider === "gemini"
        ? "Kaynak: Gemini (gemini.google.com) — yapay zekâ özeti, doğrulanmamıştır."
        : "Kaynak: kayıtlı rakip kataloğu.",
      r.fallbackFrom ? " Gemini başarısız olduğu için katalog kullanıldı." : "",
    ),
    r.summary && el("p", { class: cls.summary }, r.summary),
    el(
      "div",
      { class: cls.grid },
      r.competitors.map((c) =>
        el(
          "article",
          { class: cls.card },
          el(
            "h3",
            {},
            c.url
              ? el(
                  "a",
                  { href: c.url, target: "_blank", rel: "noopener" },
                  c.name,
                )
              : c.name,
          ),
          el("p", {}, c.summary),
          c.strengths?.length &&
            el(
              "ul",
              {},
              c.strengths.map((s) => el("li", {}, s)),
            ),
          c.pricing && el("p", { class: cls.note }, `Fiyat: ${c.pricing}`),
          c.sources?.length &&
            el(
              "p",
              { class: cls.note },
              "Kaynaklar: ",
              c.sources.map((u, i) => [
                i ? ", " : "",
                el(
                  "a",
                  { href: u, target: "_blank", rel: "noopener" },
                  host(u),
                ),
              ]),
            ),
        ),
      ),
    ),
  );
}
function renderResearch(r) {
  if (!r) return;
  $("research-card").hidden = false;
  $("research").replaceChildren(
    researchBlock(r, {
      note: "muted small",
      summary: "",
      wrap: "",
      grid: "competitors",
      card: "competitor",
    }),
  );
}
function renderRecs(c) {
  if (!c.plans?.length) return;
  if (c.input) {
    $("assumptions-card").hidden = false;
    $("assumptions").replaceChildren(
      ...[...c.input.assumptions, ...(c.recommendations?.warnings || [])].map(
        (a) => el("li", {}, a),
      ),
    );
  }
  $("recs-card").hidden = false;
  $("recs-note").textContent =
    "Rakamlar mock varsayımlara dayanır; gerçek kampanya sonucu değildir.";
  $("process").replaceChildren();
  $("recs").replaceChildren(
    window.renderPlans(c, {
      onSelect: (_, plan) =>
        select({ strategy_id: plan.strategyId, revision: 1 }),
    }) || "",
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
    // A stale #id (another data folder or deleted run) just resets the page.
    if (location.hash) {
      history.replaceState(null, "", "/campaign");
      campaignId = null;
      return;
    }
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
function fillExample() {
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
}
$("example").addEventListener("click", fillExample);
// Clicking "Mock veri" fills the form with the example business for quick tests.
document
  .querySelector('input[name="dataMode"][value="mock"]')
  .addEventListener("click", fillExample);
health();
setInterval(health, 10000);
if (location.hash.length > 1) {
  campaignId = location.hash.slice(1);
  poll();
}
