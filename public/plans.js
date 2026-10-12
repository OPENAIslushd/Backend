"use strict";
// Shared plan view for /cli and /campaign: situation summary, then each plan with its purpose,
// 30-day timeline, channel tactics and the simulation evidence for or against it.
(function () {
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
  const VERDICT = {
    supported: ["Test planı destekliyor", "ok"],
    partial: ["Test planı kısmen destekliyor", "mid"],
    rejected: ["Test planı desteklemiyor", "bad"],
  };
  const PROFILE_ORDER = ["conservative", "balanced", "high_risk_high_reward"];
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
  const pct = (n) =>
    `%${(n * 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`;
  function situation(s, provider) {
    if (!s) return null;
    return el(
      "section",
      { class: "pv-situation" },
      el("h3", {}, "Durum özeti"),
      el("p", {}, s.summary),
      s.market && el("p", {}, el("b", {}, "Pazar: "), s.market),
      s.competition && el("p", {}, el("b", {}, "Rekabet: "), s.competition),
      s.key_facts?.length &&
        el(
          "ul",
          {},
          s.key_facts.map((f) => el("li", {}, f)),
        ),
      el(
        "p",
        { class: "pv-muted" },
        provider === "codex"
          ? "Planları Codex yazdı; simülasyon onları test etti."
          : "Codex'e ulaşılamadığı için şablon planlar kullanıldı.",
      ),
    );
  }
  function timeline(plan) {
    const bar = el("div", { class: "pv-bar" });
    plan.timeline.forEach((t, i) => {
      const seg = el(
        "span",
        { class: `pv-seg pv-seg-${i % 5}`, title: t.phase },
        t.phase,
      );
      seg.style.flex = String(t.end_day - t.start_day + 1);
      bar.append(seg);
    });
    return el(
      "div",
      { class: "pv-block" },
      el("h4", {}, "30 günlük takvim"),
      bar,
      el(
        "ol",
        { class: "pv-phases" },
        plan.timeline.map((t, i) =>
          el(
            "li",
            {},
            el(
              "p",
              { class: "pv-phase-head" },
              el("span", { class: `pv-dot pv-seg-${i % 5}` }),
              `Gün ${t.start_day}–${t.end_day} · ${t.phase}`,
            ),
            t.goal && el("p", {}, t.goal),
            t.actions.length &&
              el(
                "ul",
                {},
                t.actions.map((a) => el("li", {}, a)),
              ),
            t.checkpoint &&
              el("p", { class: "pv-check" }, "Kontrol: ", t.checkpoint),
          ),
        ),
      ),
    );
  }
  function tactics(plan) {
    return el(
      "div",
      { class: "pv-block" },
      el("h4", {}, "Kanallar ve taktikler"),
      el(
        "div",
        { class: "pv-channels" },
        Object.keys(CHANNEL).map((c) => {
          const t = plan.channel_tactics.find((x) => x.channel === c);
          const bar = el("span", { class: `pv-fill ${c}` });
          bar.style.width = `${plan.allocation[c] * 100}%`;
          return el(
            "div",
            { class: "pv-channel" },
            el(
              "p",
              { class: "pv-channel-head" },
              el("b", {}, CHANNEL[c]),
              el("span", {}, pct(plan.allocation[c])),
            ),
            el("span", { class: "pv-track" }, bar),
            t?.role && el("p", { class: "pv-muted" }, t.role),
            t?.tactics.length &&
              el(
                "ul",
                {},
                t.tactics.map((x) => el("li", {}, x)),
              ),
          );
        }),
      ),
      el(
        "p",
        { class: "pv-muted" },
        `Kreatif: ${CREATIVE[plan.creative] || plan.creative}${plan.key_message ? ` — “${plan.key_message}”` : ""}`,
      ),
    );
  }
  function evidence(ev, plan) {
    if (!ev?.tested)
      return el(
        "p",
        { class: "pv-muted" },
        "Bu plan denetimden geçmediği için test edilmedi.",
      );
    return el(
      "div",
      { class: "pv-block" },
      el("h4", {}, "Test sonucu: plan tuttu mu?"),
      el(
        "table",
        { class: "pv-checks" },
        el(
          "tr",
          {},
          el("th", {}, "Planın hedefi"),
          el("th", {}, "Hedef"),
          el("th", {}, "Simülasyon"),
          el("th", {}, ""),
        ),
        ev.checks.map((c) =>
          el(
            "tr",
            { class: c.met ? "met" : "miss" },
            el("td", {}, c.label),
            el("td", {}, c.target),
            el("td", {}, c.actual),
            el("td", {}, c.met ? "✓" : "✗"),
          ),
        ),
      ),
      el(
        "ul",
        { class: "pv-findings" },
        ev.findings.map((f) => el("li", {}, f)),
      ),
      plan.risks?.length &&
        el("p", { class: "pv-muted" }, "Riskler: ", plan.risks.join(" · ")),
      el(
        "p",
        { class: "pv-muted" },
        "Simülasyon kanal paylarını, kreatifi ve 3 günlük kaydırma kuralını test eder; takvim ve taktikler uygulama planıdır, ayrıca simüle edilmez.",
      ),
    );
  }
  function card(c, plan, ev, onSelect) {
    const rec = ev?.recommendedAs;
    const v = VERDICT[ev?.verdict];
    const selected =
      c.selection?.record.strategy.strategy_id === plan.strategyId;
    const body = el(
      "div",
      { class: "pv-body" },
      timeline(plan),
      tactics(plan),
      evidence(ev, plan),
    );
    const details = el(
      "details",
      { class: "pv-details", ...(rec ? { open: "" } : {}) },
      el("summary", {}, "Planı ve test sonucunu göster"),
      body,
    );
    return el(
      "article",
      {
        class:
          "pv-plan" +
          (rec ? " recommended" : "") +
          (selected ? " selected" : ""),
      },
      el(
        "div",
        { class: "pv-tags" },
        rec && el("span", { class: "pv-tag rec" }, `${rec.label} öneri`),
        v && el("span", { class: `pv-tag ${v[1]}` }, v[0]),
      ),
      el("h3", {}, plan.name),
      el("p", { class: "pv-purpose" }, el("b", {}, "Amaç: "), plan.purpose),
      el("p", {}, el("b", {}, "Tez: "), plan.thesis),
      rec && el("p", { class: "pv-muted" }, rec.rule),
      details,
      rec && c.status === "awaiting_selection"
        ? el(
            "button",
            {
              class: "pv-select",
              type: "button",
              onclick: () => onSelect(c.campaignId, plan),
            },
            "Bu planı seç",
          )
        : selected &&
            el("p", { class: "pv-tag ok" }, "Seçildi · hafızaya kaydedildi"),
    );
  }
  window.renderPlans = function (c, { onSelect }) {
    if (!c.plans?.length) return null;
    const evByPlan = Object.fromEntries(
      (c.evidence || []).map((e) => [e.planId, e]),
    );
    const rank = (p) => {
      const r = evByPlan[p.id]?.recommendedAs;
      return r ? PROFILE_ORDER.indexOf(r.profile) : 9;
    };
    const plans = [...c.plans].sort((a, b) => rank(a) - rank(b));
    // Before the test finishes, plans are listed without evidence.
    if (!c.recommendations)
      return el(
        "div",
        { class: "pv" },
        situation(c.situation, c.planProvider),
        plans.map((p) => card(c, p, null, onSelect)),
      );
    const recommended = plans.filter((p) => evByPlan[p.id]?.recommendedAs);
    const others = plans.filter((p) => !evByPlan[p.id]?.recommendedAs);
    return el(
      "div",
      { class: "pv" },
      situation(c.situation, c.planProvider),
      el(
        "p",
        { class: "pv-muted" },
        `${c.plans.length} plan yazıldı ve ${c.audit?.approved - (c.audit?.plans || 0)} rastgele dağılımla aynı senaryolarda test edildi. Her risk profili için en iyi plan önerildi.`,
      ),
      recommended.map((p) => card(c, p, evByPlan[p.id], onSelect)),
      others.length &&
        el(
          "details",
          { class: "pv-others" },
          el("summary", {}, `Önerilmeyen planlar (${others.length})`),
          others.map((p) => card(c, p, evByPlan[p.id], onSelect)),
        ),
    );
  };
})();
