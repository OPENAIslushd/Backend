const { randomUUID } = require("node:crypto");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { AppError, publicError, now, same } = require("../runtime/core.cjs");
const { mockCampaignInput } = require("./mock-data.cjs");
const { buildEvidence } = require("./explain.cjs");
const { templatePlanner, toStrategy } = require("./planner.cjs");
const CHANNELS = ["paid_social", "paid_search", "influencer"];
const text = (max) => ({ type: "string", minLength: 1, maxLength: max });
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
const validateStart = ajv.compile({
  type: "object",
  additionalProperties: false,
  required: ["clientRequestId", "dataMode", "business"],
  properties: {
    clientRequestId: { type: "string", format: "uuid" },
    dataMode: { enum: ["mock", "real"] },
    business: {
      type: "object",
      additionalProperties: false,
      required: ["name", "description", "audience", "region"],
      properties: {
        name: text(120),
        productName: text(120),
        description: text(2000),
        url: { type: "string", maxLength: 500 },
        audience: text(500),
        region: text(200),
        topic: { type: "string", maxLength: 200 },
      },
    },
    budget: { type: "number", minimum: 1, maximum: 1000000000 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    unitContribution: { type: "number", minimum: 0, maximum: 1000000 },
  },
});
const validateSelection = ajv.compile({
  type: "object",
  additionalProperties: false,
  required: ["strategyId", "strategyRevision"],
  properties: {
    strategyId: text(120),
    strategyRevision: { type: "integer", minimum: 1 },
  },
});
const validateActual = ajv.compile({
  type: "object",
  additionalProperties: false,
  required: ["spend", "purchases", "source"],
  properties: {
    spend: { type: "number", minimum: 0 },
    purchases: { type: "integer", minimum: 0 },
    unitContribution: { type: "number", minimum: 0 },
    source: text(500),
    status: { enum: ["partial", "final"] },
    attributionEndDay: { type: "integer", minimum: 1, maximum: 365 },
  },
});
const STEPS = [
  ["research", "Rakip araştırması"],
  ["input", "Kampanya girdisi (mock veri)"],
  ["memory.retrieve", "Geçmiş seçimler"],
  ["plan", "Strateji planları"],
  ["strategy.generate", "Karşılaştırma için rastgele dağılımlar"],
  ["audit", "Orchestrator denetimi"],
  ["simulation.evaluate", "Planların testi (simülasyon)"],
  ["outcome.prepare", "Öneriler"],
];
const invalid = (message, errors) =>
  new AppError(
    "INVALID_REQUEST",
    message + (errors ? ": " + ajv.errorsText(errors) : ""),
    400,
  );
// The Orchestrator's audit before simulation: only self-consistent candidates are simulated.
function auditStrategies(strategies, input, runId) {
  const approved = [],
    rejected = [],
    seen = new Set();
  for (const s of strategies) {
    const key = `${s.strategy_id}:${s.revision}`;
    const total = CHANNELS.reduce((a, c) => a + s.initial_allocation[c], 0);
    const reason =
      s.run_id !== runId
        ? "run_id uyuşmuyor"
        : s.business_id !== input.business_id ||
            s.product_id !== input.product_id
          ? "kapsam uyuşmuyor"
          : s.budget !== input.budget || s.currency !== input.currency
            ? "bütçe/para birimi uyuşmuyor"
            : Math.abs(total - 1) > 1e-8
              ? "kanal payları 1 etmiyor"
              : CHANNELS.some(
                    (c) =>
                      s.initial_allocation[c] < s.adaptation.exploration_floor,
                  )
                ? "keşif tabanının altında kanal"
                : seen.has(key)
                  ? "tekrarlanan strateji"
                  : null;
    seen.add(key);
    if (reason) rejected.push({ strategyId: s.strategy_id, reason });
    else approved.push(s);
  }
  return { approved, rejected };
}
class CampaignService {
  constructor(
    store,
    {
      simulation,
      research,
      planner = templatePlanner(),
      fallbackPlanner = templatePlanner(),
      candidateCount = 100,
      scenarioCount = 40,
    },
  ) {
    Object.assign(this, {
      store,
      simulation,
      research,
      planner,
      fallbackPlanner,
      candidateCount,
      scenarioCount,
    });
    this.active = null;
    this.jobs = new Set();
  }
  async init() {
    for (const file of await this.store.list("campaigns")) {
      const c = await this.store.read("campaigns/" + file);
      if (c.status === "running" || c.status === "selecting")
        await this.update(c.campaignId, (c) => {
          for (const s of c.steps.filter((s) => s.status === "running"))
            Object.assign(s, { status: "failed", finishedAt: now() });
          c.status = c.recommendations ? "awaiting_selection" : "failed";
          if (!c.recommendations)
            c.error = publicError(
              new AppError(
                "RUN_INTERRUPTED",
                "Sunucu yeniden başlatıldığı için kampanya analizi kesildi.",
                502,
                true,
              ),
            );
        });
    }
  }
  async get(id) {
    const c = await this.store.read(`campaigns/${id}.json`);
    if (!c) throw new AppError("NOT_FOUND", "Kampanya bulunamadı.", 404);
    return c;
  }
  async update(id, fn) {
    return this.store.serial("campaign-" + id, async () => {
      const c = await this.get(id);
      await fn(c);
      c.updatedAt = now();
      await this.store.write(`campaigns/${id}.json`, c);
      return c;
    });
  }
  async list() {
    const all = await Promise.all(
      (await this.store.list("campaigns")).map((f) =>
        this.store.read("campaigns/" + f),
      ),
    );
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ campaignId, status, createdAt, request }) => ({
        campaignId,
        status,
        createdAt,
        business: request.business.name,
      }));
  }
  async start(request) {
    if (!validateStart(request))
      throw invalid("Geçersiz kampanya isteği", validateStart.errors);
    if (request.dataMode === "real")
      throw new AppError(
        "TOOL_UNAVAILABLE",
        "Gerçek veri modu henüz hazır değil (docs/real-data-mode.tr.md). mock kullanın.",
        400,
      );
    return this.store.serial("campaign-dispatch", async () => {
      for (const f of await this.store.list("campaigns")) {
        const c = await this.store.read("campaigns/" + f);
        if (c.request.clientRequestId === request.clientRequestId) {
          if (!same(c.request, request))
            throw new AppError(
              "IDEMPOTENCY_CONFLICT",
              "Aynı anahtar farklı içerikle kullanıldı.",
              409,
            );
          return c;
        }
      }
      if (this.active)
        throw new AppError(
          "BUSY",
          "Başka bir kampanya analizi çalışıyor; bitince tekrar deneyin.",
          429,
          true,
        );
      const id = randomUUID();
      const campaign = {
        campaignId: id,
        runId: `campaign-${id}`,
        status: "running",
        dataMode: request.dataMode,
        createdAt: now(),
        updatedAt: now(),
        request,
        steps: STEPS.map(([stepId, label]) => ({
          stepId,
          label,
          status: "pending",
          startedAt: null,
          finishedAt: null,
          summary: null,
        })),
        research: null,
        input: null,
        history: null,
        audit: null,
        recommendations: null,
        situation: null,
        plans: null,
        planProvider: null,
        evidence: null,
        selection: null,
        observation: null,
        error: null,
      };
      await this.store.write(`campaigns/${id}.json`, campaign);
      this.track(id, () => this.pipeline(id));
      return campaign;
    });
  }
  track(id, fn) {
    this.active = id;
    const job = Promise.resolve()
      .then(fn)
      .catch(async (e) => {
        await this.update(id, (c) => {
          for (const s of c.steps.filter((s) => s.status === "running"))
            Object.assign(s, { status: "failed", finishedAt: now() });
          c.status = c.status === "selecting" ? "awaiting_selection" : "failed";
          c.error = publicError(e);
        }).catch(() => {});
      })
      .finally(() => {
        if (this.active === id) this.active = null;
        this.jobs.delete(job);
      });
    this.jobs.add(job);
  }
  async idle() {
    await Promise.all([...this.jobs]);
  }
  async step(id, stepId, fn) {
    await this.update(id, (c) => {
      const s = c.steps.find((s) => s.stepId === stepId);
      Object.assign(s, { status: "running", startedAt: now() });
    });
    const { result, summary, status = "completed", patch } = await fn();
    await this.update(id, (c) => {
      const s = c.steps.find((s) => s.stepId === stepId);
      Object.assign(s, { status, finishedAt: now(), summary });
      patch?.(c);
    });
    return result;
  }
  async pipeline(id) {
    const c = await this.get(id);
    const { request, runId } = c;
    const b = request.business;
    await this.step(id, "research", async () => {
      try {
        // Live sub-progress for the slow research step; writes are serialized and only on change.
        let shown = null;
        const progress = (text) => {
          if (text === shown) return;
          shown = text;
          this.update(id, (c) => {
            const s = c.steps.find((s) => s.stepId === "research");
            if (s.status === "running") s.summary = text;
          }).catch(() => {});
        };
        const r = await this.research.research(
          { ...b, market: b.region },
          undefined,
          progress,
        );
        const source = r.provider === "gemini" ? "Gemini" : "Katalog";
        return {
          summary: r.competitors.length
            ? `${source}: ${r.competitors.length} rakip (${r.competitors.map((x) => x.name).join(", ")})${r.fallbackFrom ? " · Gemini başarısız, katalog kullanıldı" : ""}`
            : "Katalogda eşleşen rakip yok (bu, rakip olmadığı anlamına gelmez).",
          patch: (c) => (c.research = r),
        };
      } catch (e) {
        // Research is context only; the simulation does not depend on it.
        return {
          status: "failed",
          summary: e.message,
          patch: (c) => (c.research = { error: publicError(e) }),
        };
      }
    });
    const input = await this.step(id, "input", async () => {
      const input = mockCampaignInput(request, (await this.get(id)).research);
      return {
        result: input,
        summary: `${input.budget} ${input.currency} bütçe, ${input.assumptions.length} varsayım`,
        patch: (c) => (c.input = input),
      };
    });
    const scope = {
      business_id: input.business_id,
      product_id: input.product_id,
    };
    await this.step(id, "memory.retrieve", async () => {
      const history = await this.simulation.call(
        "memory.retrieve",
        scope,
        runId,
      );
      return {
        summary: `${history.records.length} geçmiş seçim`,
        patch: (c) => (c.history = history),
      };
    });
    // Plans come first: purpose, thesis, 30-day timeline, tactics and success criteria.
    const planned = await this.step(id, "plan", async () => {
      const ctx = {
        business: b,
        input,
        research: (await this.get(id)).research,
        history: (await this.get(id)).history,
      };
      let out,
        note = "";
      await this.update(id, (c) => {
        c.steps.find((s) => s.stepId === "plan").summary =
          this.planner.name === "codex"
            ? "Codex 4–5 plan yazıyor: amaç, 30 günlük takvim, taktikler, hedefler (genelde 2–4 dk)…"
            : "Planlar hazırlanıyor…";
      });
      try {
        out = await this.planner.plan(ctx);
      } catch (e) {
        out = await this.fallbackPlanner.plan(ctx);
        note = ` · ${this.planner.name || "planlayıcı"} başarısız (${e.message}); şablon planlar kullanıldı`;
      }
      const plans = out.plans.map((p) => ({
        ...p,
        strategyId: toStrategy(p, input, runId).strategy_id,
      }));
      return {
        result: { ...out, plans },
        summary: `${plans.length} plan (${out.provider === "codex" ? "Codex" : "şablon"})${note}`,
        patch: (c) => {
          c.situation = out.situation;
          c.plans = plans;
          c.planProvider = out.provider;
        },
      };
    });
    const generated = await this.step(id, "strategy.generate", async () => {
      const g = await this.simulation.call(
        "strategy.generate",
        { input, candidate_count: this.candidateCount, seed: 42, revision: 1 },
        runId,
      );
      return { result: g, summary: `${g.strategies.length} rastgele dağılım` };
    });
    const { planStrategies, baseline } = await this.step(
      id,
      "audit",
      async () => {
        const plans = auditStrategies(
          planned.plans.map((p) => toStrategy(p, input, runId)),
          input,
          runId,
        );
        const base = auditStrategies(generated.strategies, input, runId);
        if (!plans.approved.length)
          throw new AppError("INVALID_OUTPUT", "Denetimden geçen plan yok.");
        const rejected = [...plans.rejected, ...base.rejected];
        return {
          result: { planStrategies: plans.approved, baseline: base.approved },
          summary: `${plans.approved.length} plan + ${base.approved.length} rastgele dağılım onaylandı, ${rejected.length} reddedildi`,
          patch: (c) =>
            (c.audit = {
              approved: plans.approved.length + base.approved.length,
              plans: plans.approved.length,
              rejected,
            }),
        };
      },
    );
    const evaluate = async (strategies) => {
      const e = await this.simulation.call(
        "simulation.evaluate",
        { input, strategies, scenario_count: this.scenarioCount, seed: 42 },
        runId,
      );
      if (e.run_id !== runId)
        throw new AppError("INVALID_OUTPUT", "Simülasyon run_id uyuşmuyor.");
      return e;
    };
    // Plans and the random baseline run on the same seed, so they face the same scenarios.
    const { planEvaluation, baselineEvaluation } = await this.step(
      id,
      "simulation.evaluate",
      async () => {
        const planEvaluation = await evaluate(planStrategies);
        const baselineEvaluation = await evaluate(baseline);
        return {
          result: { planEvaluation, baselineEvaluation },
          summary: `${planEvaluation.results.length} plan + ${baselineEvaluation.results.length} rastgele dağılım × ${planEvaluation.scenario_count} senaryo`,
        };
      },
    );
    // outcome.select later needs the exact plan evaluation object.
    await this.store.write(`campaign-evaluations/${id}.json`, planEvaluation);
    await this.step(id, "outcome.prepare", async () => {
      const ui = await this.simulation.call(
        "outcome.prepare",
        { evaluation: planEvaluation },
        runId,
      );
      return {
        summary: `${ui.recommendations.length} plan önerildi (${ui.status})`,
        patch: (c) => {
          c.recommendations = ui;
          // Evidence is a display aid; it must never fail the run.
          try {
            c.evidence = buildEvidence({
              plans: c.plans,
              planEvaluation,
              baselineEvaluation,
              ui,
              input,
            });
          } catch {
            c.evidence = null;
          }
          c.status = "awaiting_selection";
        },
      };
    });
  }
  async select(id, request) {
    if (!validateSelection(request))
      throw invalid("Geçersiz seçim", validateSelection.errors);
    return this.store.serial("campaign-dispatch", async () => {
      const c = await this.get(id);
      if (c.selection) {
        const s = c.selection.record.strategy;
        if (
          s.strategy_id === request.strategyId &&
          s.revision === request.strategyRevision
        )
          return c;
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "Bu kampanyada zaten başka bir strateji seçildi.",
          409,
        );
      }
      if (c.status !== "awaiting_selection")
        throw new AppError(
          "APPROVAL_REQUIRED",
          "Kampanya henüz seçim beklemiyor.",
          409,
        );
      const rec = c.recommendations.recommendations.find(
        (r) =>
          r.strategy.strategy_id === request.strategyId &&
          r.strategy.revision === request.strategyRevision,
      );
      if (!rec)
        throw new AppError("NOT_FOUND", "Strateji önerilerde yok.", 404);
      if (this.active)
        throw new AppError(
          "BUSY",
          "Başka bir kampanya işlemi çalışıyor.",
          429,
          true,
        );
      const updated = await this.update(id, (c) => {
        c.status = "selecting";
        c.error = null;
      });
      this.track(id, async () => {
        const evaluation = await this.store.read(
          `campaign-evaluations/${id}.json`,
        );
        const proposal = await this.simulation.call(
          "outcome.select",
          {
            evaluation,
            strategy_id: request.strategyId,
            strategy_revision: request.strategyRevision,
            selection_id: `sel-${id}`,
            selected_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
          },
          c.runId,
        );
        if (
          proposal.proposed_action !== "memory.save_selection" ||
          proposal.payload.record.strategy.strategy_id !== request.strategyId
        )
          throw new AppError(
            "INVALID_OUTPUT",
            "Outcome önerisi denetimden geçmedi.",
          );
        const saved = await this.simulation.call(
          "memory.save_selection",
          proposal.payload,
          c.runId,
        );
        await this.update(id, (c) => {
          c.selection = saved;
          c.status = "completed";
        });
      });
      return updated;
    });
  }
  async observe(id, request) {
    if (!validateActual(request))
      throw invalid("Geçersiz gerçek sonuç", validateActual.errors);
    return this.store.serial("campaign-dispatch", async () => {
      const c = await this.get(id);
      if (!c.selection)
        throw new AppError(
          "APPROVAL_REQUIRED",
          "Önce bir strateji seçilmeli.",
          409,
        );
      if (this.active)
        throw new AppError(
          "BUSY",
          "Başka bir kampanya işlemi çalışıyor.",
          429,
          true,
        );
      const record = c.observation?.record || c.selection.record;
      const actual = {
        observation_id: `obs-${randomUUID()}`,
        observed_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        source: request.source,
        status: request.status || "final",
        attribution_end_day:
          request.attributionEndDay || record.attribution_end_day,
        spend: request.spend,
        purchases: request.purchases,
        unit_contribution:
          request.unitContribution ?? record.input.unit_contribution,
        currency: record.input.currency,
      };
      const proposal = await this.simulation.call(
        "outcome.observe",
        { record, actual },
        c.runId,
      );
      if (proposal.proposed_action !== "memory.update_actual")
        throw new AppError(
          "INVALID_OUTPUT",
          "Outcome önerisi denetimden geçmedi.",
        );
      const updated = await this.simulation.call(
        "memory.update_actual",
        proposal.payload,
        c.runId,
      );
      return this.update(id, (c) => (c.observation = updated));
    });
  }
  async health() {
    return this.simulation.health();
  }
}
module.exports = { CampaignService, auditStrategies };
