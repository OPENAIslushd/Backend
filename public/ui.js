"use strict";
const $ = (id) => document.getElementById(id);
const VERSION = "4.0.0";
const STORAGE = "slushd-playground-v1";
const DEMO =
  "Haftalık bütçeye göre yemek planı ve alışveriş listesi oluşturan bir uygulama geliştiriyorum.";
const ANSWER =
  "Türkiye’deki üniversite öğrencilerini hedefliyorum. Web sitem henüz yok. Mevcut özellikler bütçe girişi, haftalık yemek planı ve alışveriş listesi. Fiyat aylık 200 TRY abonelik. Amacım deneme kullanıcılarını ücretli aboneye dönüştürmek. Bildiğim rakip yok.";
const fields = {
  productDescription: "Ürün / fikir",
  website: "Web sitesi",
  targetCustomer: "Hedef müşteri",
  targetMarket: "Hedef pazar",
  currentFeatures: "Mevcut özellikler",
  pricing: "Fiyatlandırma",
  userGoal: "Hedef / sorun",
  knownCompetitors: "Bilinen rakipler",
};
const stepNames = {
  "memory.read": "Hafıza okunuyor",
  research: "Araştırma",
  "research.risk_reward": "Risk ve fırsatlar",
  "research.marketing": "Pazarlama",
  "research.rivals": "Rakipler",
  "research.trends": "Trendler",
  "strategy.build": "Strateji",
  "tests.run": "Simülasyon",
  "memory.update": "Hafıza kaydı",
};
const statuses = {
  pending: "Bekliyor",
  running: "Çalışıyor",
  completed: "Tamamlandı",
  partial: "Kısmi sonuç",
  failed: "Hata",
  skipped: "Atlandı",
  awaiting_approval: "Onayını bekliyor",
  cancelled: "Düzeltme istendi",
  queued: "Sırada",
};
const terminal = new Set(["completed", "partial", "failed", "cancelled"]);
let intake = null,
  run = null,
  stream = null,
  busy = false,
  refreshing = false,
  refreshAgain = false,
  generation = 0;
const retryRequests = new Map();
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function save() {
  try {
    localStorage.setItem(
      STORAGE,
      JSON.stringify({ intakeId: intake?.intakeId, runId: run?.runId }),
    );
  } catch {}
}
function errorMessage(error) {
  $("error").textContent = error.message || "İstek tamamlanamadı.";
  $("error").hidden = false;
}
async function request(path, data) {
  const signature = path + JSON.stringify(data);
  let payload;
  if (data) {
    payload = retryRequests.get(signature) || {
      schemaVersion: VERSION,
      ...data,
      [path.endsWith("/messages") ? "clientMessageId" : "clientRequestId"]:
        crypto.randomUUID(),
    };
    retryRequests.set(signature, payload);
  }
  let response;
  try {
    response = await fetch(path, {
      method: data ? "POST" : "GET",
      headers: data ? { "Content-Type": "application/json" } : undefined,
      body: data ? JSON.stringify(payload) : undefined,
    });
  } catch {
    throw new Error(
      "Backend’e ulaşılamadı. Sunucuyu kontrol edip aynı işlemi tekrar dene.",
    );
  }
  const result = await response.json();
  if (!response.ok) {
    retryRequests.delete(signature);
    const error = new Error(
      result.error?.message || `İstek başarısız (${response.status}).`,
    );
    error.code = result.error?.code;
    throw error;
  }
  retryRequests.delete(signature);
  return result;
}
async function action(fn) {
  if (busy) return;
  busy = true;
  $("error").hidden = true;
  renderControls();
  const token = generation;
  try {
    await fn();
  } catch (error) {
    if (token === generation) {
      errorMessage(error);
      if (error.code === "REVISION_CONFLICT") {
        if (intake)
          intake = await request(`/intakes/${intake.intakeId}`).catch(
            () => intake,
          );
        if (run) await refreshRun();
      }
    }
  } finally {
    busy = false;
    render();
  }
}
function display(field) {
  if (!field || field.status === "unknown") return "Henüz bilinmiyor";
  if (field.status === "not_applicable") return "Yok / uygulanmıyor";
  if (field.status === "declined") return "Paylaşılmadı";
  const value = field.value;
  if (Array.isArray(value))
    return value.map((x) => (typeof x === "object" ? x.name : x)).join(", ");
  if (value && typeof value === "object")
    return [value.model, value.amount, value.currency, value.billingPeriod]
      .filter((x) => x !== null)
      .join(" · ");
  return value;
}
function renderControls() {
  const locked = run && !terminal.has(run.status);
  $("prompt").disabled = busy || Boolean(locked);
  $("send").disabled = busy || Boolean(locked);
  $("send").textContent = busy ? "Bekleniyor…" : "Gönder ↑";
  $("reset").disabled = busy;
  for (const id of [
    "continue",
    "analyze",
    "approve",
    "correct",
    "example",
    "answer-example",
  ])
    $(id).disabled = busy;
  $("intake-actions").hidden = !intake || Boolean(locked);
  $("continue").hidden = intake?.status === "ready";
  $("analyze").hidden = intake?.status !== "ready";
  $("answer-example").hidden = !intake || Boolean(locked);
  $("example").hidden = Boolean(intake);
  $("review").hidden = run?.status !== "awaiting_approval";
}
function render() {
  renderControls();
  $("profile-status").textContent = intake
    ? intake.status === "ready"
      ? "Araştırmaya hazır"
      : "Bilgiler tamamlanıyor"
    : "Henüz başlamadı";
  $("profile").replaceChildren(
    ...Object.entries(fields).map(([key, label]) => {
      const row = node("div", undefined, "field");
      row.append(
        node("dt", label),
        node(
          "dd",
          display(intake?.product[key]),
          !intake || intake.product[key].status === "unknown" ? "unknown" : "",
        ),
      );
      return row;
    }),
  );
  if (intake) {
    const list = $("messages");
    list.replaceChildren(
      ...intake.messages.map((message) => {
        const item = node("div", undefined, `bubble ${message.role}`);
        item.append(
          node(
            "span",
            message.role === "user" ? "SEN" : "ORCHESTRATOR",
            "speaker",
          ),
          node("span", message.content),
        );
        return item;
      }),
    );
    list.scrollTop = list.scrollHeight;
  }
  $("analysis").hidden = !run;
  if (!run) return;
  $("analysis-title").textContent = statuses[run.status] || run.status;
  $("progress-count").textContent =
    `${run.steps.filter((s) => ["completed", "partial", "failed", "skipped"].includes(s.status)).length} / 9 adım`;
  $("steps").replaceChildren(
    ...run.steps.map((s) => {
      const li = node("li", undefined, s.status);
      li.append(
        node("span", undefined, "step-dot"),
        node("span", stepNames[s.stepId] || s.stepId),
      );
      li.title = statuses[s.status];
      li.setAttribute(
        "aria-label",
        `${stepNames[s.stepId]}: ${statuses[s.status]}`,
      );
      return li;
    }),
  );
  if (run.review && run.status === "awaiting_approval") {
    const content = $("review-content");
    content.replaceChildren();
    for (const [label, value] of [
      ["Onaylanacak ürün profili", run.review.input.product],
      ["Araştırma bulguları", run.review.research],
      ["Hafıza bağlamı", run.review.memoryContext],
    ]) {
      const details = node("details");
      details.append(
        node("summary", label),
        node("pre", JSON.stringify(value, null, 2)),
      );
      content.append(details);
    }
    const ul = node("ul", undefined, "limitations");
    for (const limitation of run.review.limitations)
      ul.append(node("li", limitation));
    content.append(ul);
  }
  $("raw").hidden = false;
  $("raw-output").textContent = JSON.stringify(run, null, 2);
  $("result").hidden = !run.result;
  if (run.result) {
    const result = run.result;
    const container = $("result");
    container.replaceChildren(node("h3", "Analiz sonucu"));
    if (result.buildSuggestion.data) {
      const card = node("div", undefined, "result-card");
      card.append(
        node("h3", "Önerilen strateji"),
        node("p", result.buildSuggestion.data.summary),
      );
      for (const feature of result.buildSuggestion.data.mvpFeatures)
        card.append(node("p", `${feature.title} — ${feature.description}`));
      container.append(card);
    }
    if (result.testResults.data) {
      container.append(node("p", result.testResults.data.disclaimer, "hint"));
      const grid = node("div", undefined, "result-grid");
      for (const scenario of result.testResults.data.scenarios) {
        const card = node("div", undefined, "result-card");
        const assessment =
          result.testResults.data.evaluation.scenarioAssessments.find(
            (a) => a.scenarioId === scenario.scenarioId,
          );
        card.append(
          node(
            "h3",
            `${scenario.scenarioId.includes("pessimistic") ? "Kötümser senaryo" : "İyimser senaryo"} · ${scenario.outcome === "success" ? "Başarılı" : "Başarısız"}`,
          ),
        );
        for (const reason of assessment?.reasons || [])
          card.append(node("p", reason.explanation));
        grid.append(card);
      }
      container.append(grid);
    }
    container.append(
      node(
        "p",
        result.memoryUpdate.status === "completed"
          ? "✓ Sonuç JSON hafızasına kaydedildi."
          : "Hafıza kaydı tamamlanamadı; mevcut sonuçlar korundu.",
        "hint",
      ),
    );
    for (const warning of result.warnings)
      container.append(node("p", warning, "hint"));
  }
}
async function refreshRun() {
  if (!run) return;
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  const id = run.runId;
  try {
    const next = await request(`/analyses/${id}`);
    if (run?.runId === id) {
      if (next.lastSequence >= run.lastSequence) run = next;
      save();
      render();
      if (terminal.has(run.status)) {
        stream?.close();
        stream = null;
        $("stream-status").textContent =
          run.status === "cancelled"
            ? "Bilgileri sohbette düzeltip yeni bir analiz başlatabilirsin."
            : "Analiz tamamlandı.";
      }
    }
  } catch (error) {
    errorMessage(error);
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      await refreshRun();
    }
  }
}
function connect() {
  stream?.close();
  stream = null;
  if (!run || terminal.has(run.status)) return;
  const id = run.runId;
  const source = new EventSource(
    `/analyses/${id}/events?after=${run.lastSequence}`,
  );
  stream = source;
  source.onopen = () => {
    $("stream-status").textContent = "İlerleme canlı olarak güncelleniyor.";
  };
  for (const type of [
    "run.accepted",
    "run.started",
    "step.started",
    "step.finished",
    "run.awaiting_approval",
    "run.approved",
    "run.finished",
    "run.cancelled",
  ])
    source.addEventListener(type, (event) => {
      if (run?.runId !== id) return;
      const data = JSON.parse(event.data);
      if (data.sequence > run.lastSequence) void refreshRun();
    });
  source.onerror = () => {
    if (run?.runId === id && !terminal.has(run.status)) {
      $("stream-status").textContent = "İlerleme bağlantısı yenileniyor…";
      void refreshRun();
    }
  };
}
$("prompt-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("prompt").value.trim();
  if (!text) return;
  void action(async () => {
    if (intake) {
      intake = await request(`/intakes/${intake.intakeId}/messages`, {
        expectedRevision: intake.revision,
        action: "reply",
        message: text,
      });
      if (run && terminal.has(run.status)) {
        run = null;
        stream?.close();
      }
    } else
      intake = await request("/intakes", {
        message: text,
        language: "tr",
        mode: "demo",
        testMode: "simulation",
      });
    $("prompt").value = "";
    save();
  });
});
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("prompt-form").requestSubmit();
  }
});
$("example").onclick = () => {
  $("prompt").value = DEMO;
  $("prompt").focus();
};
$("answer-example").onclick = () => {
  $("prompt").value = ANSWER;
  $("prompt").focus();
};
$("continue").onclick = () =>
  void action(async () => {
    intake = await request(`/intakes/${intake.intakeId}/messages`, {
      expectedRevision: intake.revision,
      action: "continue_with_unknowns",
      message: null,
    });
    save();
  });
$("analyze").onclick = () =>
  void action(async () => {
    const accepted = await request("/analyze", {
      intakeId: intake.intakeId,
      intakeRevision: intake.revision,
    });
    run = {
      ...accepted,
      lastSequence: 0,
      steps: [],
      review: null,
      result: null,
    };
    save();
    await refreshRun();
    connect();
    $("analysis").scrollIntoView({ behavior: "smooth", block: "start" });
  });
async function decision(value) {
  await action(async () => {
    const id = run.runId;
    await request(`/analyses/${id}/approval`, {
      reviewRevision: run.review.revision,
      decision: value,
    });
    await refreshRun();
    if (value !== "request_changes") connect();
  });
  if (run?.status === "cancelled") {
    $("prompt").focus();
    $("prompt").scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
$("approve").onclick = () => void decision("approve");
$("correct").onclick = () => void decision("request_changes");
$("reset").onclick = () => {
  generation++;
  stream?.close();
  stream = null;
  intake = null;
  run = null;
  retryRequests.clear();
  save();
  $("messages").replaceChildren(
    node("p", "Yeni fikrini aşağıya yazabilirsin.", "hint"),
  );
  $("prompt").value = "";
  $("error").hidden = true;
  render();
  $("prompt").focus();
};
(async () => {
  render();
  try {
    const health = await request("/health");
    $("connection").textContent =
      health.intakeExtractor === "cli"
        ? "CLI çıkarımı · Demo analiz"
        : "Demo bağlantısı hazır";
    $("notice").textContent =
      health.intakeExtractor === "cli"
        ? "Ürün bilgileri CLI ile çıkarılır. Analiz adaptörleri: " +
          health.agents +
          "."
        : "Demo modu: tam analiz için örnek fikri kullan. Takip yanıtlarını “Hedef pazar: Türkiye” gibi etiketlerle yazabilirsin.";
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE));
    } catch {}
    if (saved?.intakeId) intake = await request(`/intakes/${saved.intakeId}`);
    if (saved?.runId) {
      run = await request(`/analyses/${saved.runId}`);
      connect();
    }
    render();
  } catch (error) {
    errorMessage(error);
    $("connection").textContent = "Bağlantıyı kontrol et";
    render();
  }
})();
