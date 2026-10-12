"use strict";
const $ = (id) => document.getElementById(id);
const FIELDS = [
  ["name", "İşletme adı", true],
  ["productName", "Ürün adı", false],
  ["description", "Ne yapıyor?", true],
  ["audience", "Hedef kitle", true],
  ["region", "Bölge / pazar", true],
  ["topic", "Araştırma konusu", false],
  ["url", "Web sitesi", false],
  ["budget", "30 günlük bütçe", false, "number"],
  ["currency", "Para birimi", false],
  ["unitContribution", "Satış başı katkı payı", false, "number"],
];
const MOCK_PROFILES = [
  {
    name: "Yakalıyo",
    productName: "Yakalıyo Sadakat",
    description:
      "Kafe ve restoranlara NFC ve QR ile check-in, markalı sadakat programı, otomatik geri kazanma kampanyaları ve segmentli müşteri paneli sunar.",
    audience: "İstanbul’daki bağımsız kafe ve restoran sahipleri",
    region: "Türkiye",
    topic: "Müşteri sadakat programı",
    url: null,
    budget: 50000,
    currency: "TRY",
    unitContribution: 900,
  },
  {
    name: "TakımPlan",
    productName: "TakımPlan Pro",
    description: "Küçük ekipler için görev ve proje yönetimi uygulaması.",
    audience: "10–50 kişilik ajans ve yazılım ekipleri",
    region: "Türkiye",
    topic: "Görev yönetimi",
    url: null,
    budget: null,
    currency: null,
    unitContribution: null,
  },
];
const PROFILE_LABEL = {
  conservative: "Temkinli",
  balanced: "Dengeli",
  high_risk_high_reward: "Yüksek risk / getiri",
};
const ICON = { pending: "○", running: "◐", completed: "●", failed: "✕" };
const emptyProfile = () => Object.fromEntries(FIELDS.map(([k]) => [k, null]));
let profile = emptyProfile(),
  busy = false,
  retry = null,
  mockIndex = 0;
const messages = [];
const campaigns = new Map();
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs))
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  for (const c of children.flat(Infinity))
    if (c != null && c !== false)
      node.append(c instanceof Node ? c : String(c));
  return node;
}
const fmt = (n, d = 0) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("tr-TR", { maximumFractionDigits: d });
const pct = (n) => (n == null ? "—" : `%${fmt(n * 100, 1)}`);
const missing = () =>
  FIELDS.filter(([k, , required]) => required && !profile[k]).map(
    ([, label]) => label,
  );
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}
function showError(message) {
  $("error").textContent = message || "";
  $("error").hidden = !message;
}
function renderProfile() {
  $("profile-fields").replaceChildren(
    ...FIELDS.map(([key, label, required, type]) => {
      const input = el("input", {
        type: type || "text",
        "data-key": key,
        placeholder: required ? "zorunlu" : "opsiyonel",
      });
      input.value = profile[key] ?? "";
      input.addEventListener("change", () => {
        const v = input.value.trim();
        profile[key] =
          v === ""
            ? null
            : type === "number"
              ? Number(v)
              : key === "currency"
                ? v.toUpperCase()
                : v;
        renderProfile();
      });
      return el(
        "label",
        { class: "cp-field" + (profile[key] ? " filled" : "") },
        el("span", {}, label, required ? " *" : ""),
        input,
      );
    }),
  );
  const gaps = missing();
  $("missing").textContent = gaps.length
    ? `Eksik: ${gaps.join(", ")}`
    : "Zorunlu bilgiler tamam. Bütçe boşsa mock varsayım kullanılır.";
  $("profile-status").textContent = gaps.length ? "Eksik" : "Hazır";
  $("profile-status").className = "cp-status" + (gaps.length ? "" : " ready");
  $("generate").disabled = busy || gaps.length > 0;
}
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
function campaignView(c) {
  if (!c) return el("p", {}, "Strateji hazırlanıyor…");
  const cur = c.recommendations?.currency || c.input?.currency || "";
  const selected = c.selection?.record.strategy;
  const research = researchBlock(c.research, {
    note: "cp-note",
    summary: "cp-market",
    wrap: "cp-research",
    grid: "cp-competitors",
    card: "cp-competitor",
  });
  return el(
    "div",
    { class: "cp-campaign" },
    el(
      "ol",
      { class: "cp-steps" },
      c.steps.map((s) =>
        el(
          "li",
          { class: s.status },
          el("span", { class: "cp-icon" }, ICON[s.status]),
          el("span", {}, s.label),
          el("span", { class: "cp-summary" }, (s.summary || "") + elapsed(s)),
        ),
      ),
    ),
    research,
    c.input &&
      el(
        "details",
        { class: "cp-assumptions" },
        el("summary", {}, `Varsayımlar (${c.input.assumptions.length})`),
        el(
          "ul",
          {},
          c.input.assumptions.map((a) => el("li", {}, a)),
        ),
      ),
    window.renderPlans(c, {
      onSelect: (id, plan) =>
        select(id, { strategy_id: plan.strategyId, revision: 1 }),
    }),
    c.error && el("p", { class: "cp-error" }, c.error.message),
  );
}
function render() {
  if (!messages.length) return;
  $("messages").replaceChildren(
    ...messages.map((m) =>
      el(
        "div",
        { class: "bubble " + m.role },
        el(
          "span",
          { class: "speaker" },
          m.role === "user"
            ? "SEN"
            : m.campaignId
              ? "ORCHESTRATOR · STRATEJİ"
              : "CODEX · CANLI",
        ),
        m.campaignId
          ? campaignView(campaigns.get(m.campaignId))
          : el("span", {}, m.content),
      ),
    ),
  );
  $("messages").scrollTop = $("messages").scrollHeight;
}
function setBusy(value, label) {
  busy = value;
  for (const id of ["send", "prompt", "example", "clear-chat", "mock-fill"])
    $(id).disabled = value;
  $("send").textContent = value ? label || "Codex yanıtlıyor…" : "Gönder ↑";
  renderProfile();
}
function summarize(c) {
  if (c.status === "failed") return `Strateji üretilemedi: ${c.error?.message}`;
  if (!c.recommendations) return "Strateji hazırlanıyor.";
  const names = c.recommendations.recommendations
    .map((r) => `${PROFILE_LABEL[r.profile]}: ${r.strategy.name}`)
    .join("; ");
  const purposes = (c.plans || [])
    .map((p) => `${p.name} (amaç: ${p.purpose})`)
    .join("; ");
  const chosen = c.selection
    ? ` Kullanıcı seçti: ${c.selection.record.strategy.name}.`
    : "";
  return `Planlar: ${purposes}. Önerilenler: ${names}.${chosen}`;
}
async function poll(id) {
  try {
    const c = await api(`/campaigns/${id}`);
    campaigns.set(id, c);
    const m = messages.find((x) => x.campaignId === id);
    if (m) m.content = summarize(c);
    render();
    if (c.status === "running" || c.status === "selecting")
      return setTimeout(() => poll(id), 800);
    setBusy(false);
  } catch (e) {
    showError(e.message);
    setBusy(false);
  }
}
async function generate() {
  if (busy || missing().length) return;
  showError("");
  const business = {};
  for (const k of [
    "name",
    "productName",
    "description",
    "audience",
    "region",
    "topic",
    "url",
  ])
    if (profile[k]) business[k] = profile[k];
  const request = {
    clientRequestId: crypto.randomUUID(),
    dataMode: "mock",
    business,
  };
  for (const k of ["budget", "currency", "unitContribution"])
    if (profile[k] != null) request[k] = profile[k];
  setBusy(true, "Strateji üretiliyor…");
  try {
    const c = await api("/campaigns", {
      method: "POST",
      body: JSON.stringify(request),
    });
    campaigns.set(c.campaignId, c);
    messages.push({
      role: "assistant",
      campaignId: c.campaignId,
      content: "Strateji hazırlanıyor.",
    });
    render();
    poll(c.campaignId);
  } catch (e) {
    showError(e.message);
    setBusy(false);
  }
}
async function select(id, strategy) {
  if (busy) return;
  showError("");
  setBusy(true, "Seçim kaydediliyor…");
  try {
    await api(`/campaigns/${id}/selection`, {
      method: "POST",
      body: JSON.stringify({
        strategyId: strategy.strategy_id,
        strategyRevision: strategy.revision,
      }),
    });
    poll(id);
  } catch (e) {
    showError(e.message);
    setBusy(false);
  }
}
$("prompt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("prompt").value.trim();
  if (busy || !text) return;
  setBusy(true);
  showError("");
  if (!retry || retry.message !== text) {
    retry = {
      schemaVersion: "4.0.0",
      clientRequestId: crypto.randomUUID(),
      message: text,
      // Last 20 turns give the model conversation context.
      history: messages
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) })),
      profile: { ...profile },
    };
    messages.push({ role: "user", content: text });
    render();
  }
  let start = false;
  try {
    const data = await api("/cli/messages", {
      method: "POST",
      body: JSON.stringify(retry),
    });
    messages.push({ role: "assistant", content: data.reply });
    profile = data.profile;
    $("prompt").value = "";
    retry = null;
    start = data.generate;
    render();
  } catch (e) {
    showError(e.message);
  } finally {
    setBusy(false);
    $("prompt").focus();
  }
  if (start) generate();
});
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("prompt-form").requestSubmit();
  }
});
$("example").onclick = () => {
  $("prompt").value =
    "Merhaba! Yakalıyo adında bir işletmem var. Kafe ve restoranlara NFC ve QR ile sadakat programı sunuyoruz; Türkiye’de satıyoruz.";
  $("prompt").focus();
};
$("mock-fill").onclick = () => {
  profile = { ...emptyProfile(), ...MOCK_PROFILES[mockIndex] };
  mockIndex = (mockIndex + 1) % MOCK_PROFILES.length;
  renderProfile();
};
$("generate").onclick = generate;
$("clear-chat").onclick = () => {
  messages.length = 0;
  campaigns.clear();
  retry = null;
  profile = emptyProfile();
  $("messages").replaceChildren();
  $("prompt").value = "";
  showError("");
  renderProfile();
  $("prompt").focus();
};
async function health() {
  try {
    const { services } = await api("/campaigns/health");
    $("health").replaceChildren(
      ...Object.entries(services).map(([name, state]) =>
        el(
          "li",
          {
            class: state,
            title:
              state === "ok"
                ? "çalışıyor"
                : "kapalı — sunucuyu yeniden başlatın",
          },
          name,
        ),
      ),
    );
  } catch {
    $("health").replaceChildren(el("li", { class: "down" }, "orchestrator"));
  }
}
renderProfile();
health();
setInterval(health, 10000);
