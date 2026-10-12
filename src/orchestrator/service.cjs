const { randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  VERSION,
  AppError,
  schema,
  invariant,
  checks,
  skipped,
  failure,
  now,
  same,
  duplicate,
  bounded,
} = require("../runtime/core.cjs");
const { runCli } = require("../runtime/cli.cjs");
const { specialists } = require("../adapters/demo.cjs");
const specs = [
  ["memory.read", "memory", "MemoryContextResult", "memoryContext"],
  ["research", "research", "ResearchResult", "research"],
  ...Object.entries(specialists).map(([task, [key, type]]) => [
    "research." + task,
    task,
    type,
    key,
  ]),
  ["strategy.build", "strategy", "BuildSuggestionResult", "buildSuggestion"],
  ["tests.run", "simulation", "TestResultsResult", "testResults"],
  ["memory.update", "memory", "MemoryReceiptResult", "memoryUpdate"],
];
const terminal = new Set(["completed", "partial", "failed", "skipped"]);
const final = new Set(["completed", "partial", "failed", "cancelled"]);
class Orchestrator {
  constructor(
    store,
    intakes,
    adapters,
    { timeoutMs = 30000, phaseTimeoutMs = 120000 } = {},
  ) {
    Object.assign(this, {
      store,
      intakes,
      adapters,
      timeoutMs,
      phaseTimeoutMs,
    });
    this.runs = new Map();
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
    this.jobs = new Set();
    this.active = null;
    this.faults = new Set();
  }
  async init() {
    for (const file of await this.store.list("runs")) {
      const r = await this.store.read("runs/" + file);
      schema("Snapshot", r.snapshot);
      this.runs.set(r.snapshot.runId, r);
    }
    for (const r of this.runs.values()) {
      if (
        !final.has(r.snapshot.status) &&
        r.snapshot.status !== "awaiting_approval"
      )
        await this.recover(r.snapshot.runId);
    }
  }
  get(id) {
    if (this.faults.has(id))
      throw new AppError(
        "STORAGE_FAILED",
        "Run günlüğü kaydedilemedi; son kalıcı veriler diskte korundu.",
        500,
        true,
      );
    const r = this.runs.get(id);
    if (!r) throw new AppError("NOT_FOUND", "Analiz bulunamadı.", 404);
    return structuredClone(r);
  }
  async mutate(id, fn) {
    return this.store.serial("run-" + id, async () => {
      const r = this.get(id);
      const pending = [];
      const emit = (type, payload, message = type) => {
        const event = {
          schemaVersion: VERSION,
          runId: id,
          sequence: r.events.length + 1,
          timestamp: now(),
          type,
          message,
          progress: {
            settledSteps: r.snapshot.steps.filter((x) => terminal.has(x.status))
              .length,
            totalSteps: 9,
          },
          payload: structuredClone(payload),
        };
        schema("", event, "events");
        r.events.push(event);
        r.snapshot.lastSequence = event.sequence;
        pending.push(event);
        return event;
      };
      await fn(r, emit);
      schema("Snapshot", r.snapshot);
      await this.store.write(`runs/${id}.json`, r);
      this.runs.set(id, r);
      for (const event of pending) this.emitter.emit(id, event);
      return structuredClone(r);
    });
  }
  accepted(r) {
    return {
      schemaVersion: VERSION,
      runId: r.snapshot.runId,
      status: r.snapshot.status,
      links: {
        events: `/analyses/${r.snapshot.runId}/events`,
        snapshot: `/analyses/${r.snapshot.runId}`,
      },
    };
  }
  async analyze(request) {
    schema("Request", request, "analysis", "INVALID_REQUEST");
    return this.store.serial("dispatch", () =>
      this.store.serial("intake-mutations", async () => {
        for (const r of this.runs.values())
          if (r.request.clientRequestId === request.clientRequestId) {
            duplicate(r.request, request);
            return this.accepted(r);
          }
        if (this.active)
          throw new AppError(
            "BUSY",
            "Başka bir analiz adımı çalışıyor.",
            429,
            true,
          );
        const s = (await this.intakes.get(request.intakeId)).snapshot;
        if (s.revision !== request.intakeRevision)
          throw new AppError(
            "REVISION_CONFLICT",
            "Intake revizyonu değişti.",
            409,
          );
        if (s.status !== "ready")
          throw new AppError(
            "INTAKE_NOT_READY",
            "Ürün açıklaması ve eksik bilgi seçimi gerekli.",
            409,
          );
        const input = {
          ...request,
          language: s.language,
          mode: s.mode,
          testMode: s.testMode,
          product: structuredClone(s.product),
          limitations: [...s.limitations],
          allowIncomplete: s.allowIncomplete,
        };
        schema("AnalysisInput", input);
        if (!this.adapters.supports(input))
          throw new AppError(
            "TOOL_UNAVAILABLE",
            "Bu profil/mod için agent adaptörü yok. Demo yalnız belgelenmiş yemek planı açıklamasını destekler.",
            400,
          );
        const id = randomUUID(),
          r = {
            request,
            input,
            createdAt: now(),
            approvalRequest: null,
            approvalResponse: null,
            events: [],
            snapshot: {
              schemaVersion: VERSION,
              runId: id,
              status: "queued",
              lastSequence: 0,
              steps: specs.map(([stepId, agentId]) => ({
                stepId,
                parentStepId: stepId.startsWith("research.")
                  ? "research"
                  : null,
                agentId,
                status: "pending",
                startedAt: null,
                finishedAt: null,
                output: null,
              })),
              review: null,
              approval: null,
              result: null,
            },
          };
        const accepted = this.accepted(r);
        this.runs.set(id, r);
        try {
          await this.mutate(id, (_, emit) =>
            emit("run.accepted", accepted, "Analiz kabul edildi."),
          );
        } catch (e) {
          this.runs.delete(id);
          throw e;
        }
        this.launch(id, (signal) => this.researchPhase(id, signal));
        return accepted;
      }),
    );
  }
  launch(id, fn) {
    this.active = id;
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new AppError("TIMEOUT", "Analiz fazı süre sınırını aştı.", 504, true),
        ),
      this.phaseTimeoutMs,
    );
    const job = Promise.resolve()
      .then(() => fn(controller.signal))
      .catch(async (error) => {
        if (error.code === "STORAGE_FAILED") {
          this.faults.add(id);
          this.emitter.emit(id, null);
          return;
        }
        try {
          await this.recover(id, error);
        } catch {
          this.faults.add(id);
          this.emitter.emit(id, null);
        }
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.active === id) this.active = null;
        this.jobs.delete(job);
      });
    this.jobs.add(job);
  }
  async idle() {
    await Promise.all([...this.jobs]);
  }
  step(id, stepId) {
    return this.get(id).snapshot.steps.find((s) => s.stepId === stepId);
  }
  async startStep(id, stepId) {
    await this.mutate(id, (r, emit) => {
      const s = r.snapshot.steps.find((s) => s.stepId === stepId);
      if (s.status !== "pending")
        throw new AppError(
          "INVALID_OUTPUT",
          "Adım yalnız bir kez başlatılabilir.",
        );
      s.status = "running";
      s.startedAt = now();
      const e = emit("step.started", { step: s }, `${stepId} başladı.`);
      s.startedAt = e.timestamp;
      e.payload.step.startedAt = e.timestamp;
    });
  }
  async endStep(id, stepId, output) {
    const spec = specs.find((x) => x[0] === stepId);
    schema(spec[2], output);
    await this.mutate(id, (r, emit) => {
      const s = r.snapshot.steps.find((s) => s.stepId === stepId);
      if (terminal.has(s.status))
        throw new AppError("INVALID_OUTPUT", "Adım zaten sonuçlandı.");
      if (output.status !== "skipped" && s.status !== "running")
        throw new AppError("INVALID_OUTPUT", "Adım başlamadı.");
      if (output.status === "skipped" && s.status !== "pending")
        output = failure(
          new AppError("INVALID_OUTPUT", "Başlayan adım atlanamaz."),
        );
      s.status = output.status;
      s.output = output;
      s.finishedAt = now();
      const e = emit(
        "step.finished",
        { step: s },
        `${stepId}: ${output.status}`,
      );
      s.finishedAt = e.timestamp;
      e.payload.step.finishedAt = e.timestamp;
    });
  }
  async call(id, stepId, method, input, signal, verify = () => {}) {
    await this.startStep(id, stepId);
    let result;
    try {
      result = await bounded(
        (s) =>
          this.adapters[method](structuredClone(input), { signal: s, runCli }),
        this.timeoutMs,
        signal,
      );
      schema(specs.find((x) => x[0] === stepId)[2], result);
      if (result.status === "skipped")
        throw new AppError("INVALID_OUTPUT", "Çağrılan agent skipped dönemez.");
      invariant(() => checks.assertOrigins(result, this.get(id).input.mode));
      verify(result);
    } catch (e) {
      result = failure(e);
    }
    await this.endStep(id, stepId, result);
    return result;
  }
  async research(id, signal) {
    await this.startStep(id, "research");
    const input = this.get(id).input;
    let result,
      open = true;
    const progressJobs = [];
    const onStep = (update) => {
      const job = this.store.serial("research-progress-" + id, async () => {
        if (!open || signal.aborted) return;
        if (!specialists[update.task])
          throw new AppError("INVALID_OUTPUT", "Bilinmeyen araştırma uzmanı.");
        const stepId = "research." + update.task;
        if (update.status === "running") await this.startStep(id, stepId);
        else if (update.status === "finished") {
          if (this.step(id, stepId).status === "pending")
            await this.startStep(id, stepId);
          let out = update.output;
          try {
            schema(specialists[update.task][1], out);
            this.checkSpecialist(update.task, out, input.mode);
          } catch (e) {
            out = failure(e);
          }
          await this.endStep(id, stepId, out);
        } else
          throw new AppError("INVALID_OUTPUT", "Geçersiz uzman ilerlemesi.");
      });
      progressJobs.push(job);
      job.catch(() => {});
      return job;
    };
    try {
      result = await bounded(
        (s) =>
          this.adapters.research(
            { runId: id, input: structuredClone(input) },
            { signal: s, runCli, onStep },
          ),
        this.timeoutMs,
        signal,
      );
      await Promise.all(progressJobs);
      schema("ResearchResult", result);
      if (result.status === "skipped")
        throw new AppError(
          "INVALID_OUTPUT",
          "Çağrılan Research skipped dönemez.",
        );
      invariant(() => {
        checks.checkResearch(result);
        checks.assertOrigins(result, input.mode);
      });
    } catch (e) {
      result = failure(e);
    } finally {
      open = false;
      await Promise.allSettled(progressJobs);
    }
    // Preserve independently validated specialist results even when the parent fails or times out.
    for (const [task, [key]] of Object.entries(specialists)) {
      const stepId = "research." + task;
      const step = this.step(id, stepId);
      if (!terminal.has(step.status)) {
        if (step.status === "pending") await this.startStep(id, stepId);
        let out =
          result.data?.[key] ||
          failure(
            new AppError(
              result.error?.code || "DEPENDENCY_FAILED",
              "Araştırma uzmanı sonuç üretmedi.",
            ),
          );
        try {
          schema(specialists[task][1], out);
          this.checkSpecialist(task, out, input.mode);
        } catch (e) {
          out = failure(e);
        }
        await this.endStep(id, stepId, out);
      }
    }
    const parts = Object.fromEntries(
      Object.entries(specialists).map(([task, [key]]) => [
        key,
        this.step(id, "research." + task).output,
      ]),
    );
    const usable = Object.values(parts).some((x) => x.data);
    const all = Object.values(parts).every((x) => x.status === "completed");
    if (usable) {
      result = {
        status: all ? "completed" : "partial",
        origin: "derived",
        data: {
          summary:
            result.data?.summary || "Kullanılabilir uzman sonuçları korundu.",
          ...parts,
        },
        error: all
          ? null
          : result.error || {
              code: "DEPENDENCY_FAILED",
              message: "Bazı araştırma çıktıları eksik.",
              retryable: true,
            },
      };
      try {
        invariant(() => checks.checkResearch(result));
      } catch (e) {
        result = failure(e);
      }
    }
    await this.endStep(id, "research", result);
    return result;
  }
  checkSpecialist(task, out, mode) {
    invariant(() => {
      checks.assertOrigins(out, mode);
      if (!out.data) return;
      const parts = Object.fromEntries(
        Object.values(specialists).map(([key]) => [key, skipped()]),
      );
      parts[specialists[task][0]] = out;
      checks.checkResearch({ status: "partial", data: { ...parts } });
    });
  }
  async researchPhase(id, signal) {
    await this.mutate(id, (r, emit) => {
      r.snapshot.status = "running";
      emit("run.started", { status: "running" }, "Araştırma başladı.");
    });
    const r = this.get(id);
    await Promise.all([
      this.call(
        id,
        "memory.read",
        "memoryRead",
        {
          runId: id,
          namespace: r.input.mode,
          idea: r.input.product.productDescription.value,
          limit: 3,
        },
        signal,
        (out) => {
          if (out.data && out.data.namespace !== r.input.mode)
            throw new AppError(
              "INVALID_OUTPUT",
              "Hafıza namespace uyuşmazlığı.",
            );
        },
      ),
      this.research(id, signal),
    ]);
    await this.mutate(id, (r, emit) => {
      r.snapshot.review = {
        revision: 1,
        input: structuredClone(r.input),
        research: r.snapshot.steps.find((x) => x.stepId === "research").output,
        memoryContext: r.snapshot.steps.find((x) => x.stepId === "memory.read")
          .output,
        limitations: [
          ...r.input.limitations,
          "Demo simülasyonu gerçek ürün testi değildir.",
          ...r.snapshot.steps
            .filter((s) => s.output?.error)
            .map((s) => `${s.stepId}: ${s.output.error.message}`),
        ],
      };
      r.snapshot.status = "awaiting_approval";
      emit(
        "run.awaiting_approval",
        r.snapshot.review,
        "Araştırma ve hafıza verilerini onaylayın.",
      );
    });
  }
  async approve(id, request) {
    schema("ApprovalRequest", request, "analysis", "INVALID_REQUEST");
    return this.store.serial("dispatch", async () => {
      const r = this.get(id);
      if (r.approvalRequest) {
        duplicate(r.approvalRequest, request);
        return r.approvalResponse;
      }
      if (r.snapshot.status !== "awaiting_approval")
        throw new AppError(
          "APPROVAL_REQUIRED",
          "Analiz henüz onay beklemiyor.",
          409,
        );
      if (request.reviewRevision !== r.snapshot.review.revision)
        throw new AppError(
          "REVISION_CONFLICT",
          "Gösterilen sonuç revizyonu değişti.",
          409,
        );
      if (request.decision === "approve" && this.active)
        throw new AppError(
          "BUSY",
          "Başka bir analiz adımı çalışıyor.",
          429,
          true,
        );
      const updated = await this.mutate(id, (r, emit) => {
        r.approvalRequest = request;
        r.snapshot.approval = { request, decidedAt: now() };
        if (request.decision === "request_changes") {
          r.snapshot.status = "cancelled";
          for (const s of r.snapshot.steps.filter(
            (x) => x.status === "pending",
          )) {
            s.status = "skipped";
            s.output = skipped();
            s.finishedAt = now();
            const e = emit("step.finished", { step: s });
            s.finishedAt = e.timestamp;
            e.payload.step.finishedAt = e.timestamp;
          }
          emit(
            "run.cancelled",
            {
              intakeId: r.input.intakeId,
              intakeRevision: r.input.intakeRevision,
            },
            "Intake profilini düzeltip yeni revizyonla analiz başlatın.",
          );
        } else {
          r.snapshot.status = "running";
          emit("run.approved", r.snapshot.approval, "Veriler onaylandı.");
        }
        r.approvalResponse = structuredClone(r.snapshot);
      });
      if (request.decision === "approve")
        this.launch(id, (s) => this.strategyPhase(id, s));
      return updated.approvalResponse;
    });
  }
  async strategyPhase(id, signal) {
    const r = this.get(id),
      review = r.snapshot.review,
      approval = r.snapshot.approval;
    if (
      approval?.request.decision !== "approve" ||
      approval.request.reviewRevision !== review.revision
    )
      throw new AppError("APPROVAL_REQUIRED", "Geçerli onay bulunamadı.", 409);
    const buildInput = {
      runId: id,
      input: r.input,
      memoryContext: review.memoryContext,
      research: review.research,
      review,
      approval,
    };
    schema("BuildInput", buildInput);
    const build = await this.call(
      id,
      "strategy.build",
      "strategy",
      buildInput,
      signal,
      (out) => invariant(() => checks.checkTests(out, skipped())),
    );
    if (build.status === "completed")
      await this.call(
        id,
        "tests.run",
        "simulate",
        { runId: id, buildSuggestion: build.data },
        signal,
        (out) => invariant(() => checks.checkTests(build, out)),
      );
    else await this.endStep(id, "tests.run", skipped());
    await this.persistAndFinish(id, signal);
  }
  content(id) {
    const r = this.get(id);
    const get = (step) =>
      r.snapshot.steps.find((x) => x.stepId === step).output || skipped();
    return {
      input: r.input,
      memoryContext: get("memory.read"),
      research: get("research"),
      buildSuggestion: get("strategy.build"),
      testResults: get("tests.run"),
      review: r.snapshot.review,
      approval: r.snapshot.approval,
      warnings: [
        ...new Set([
          ...r.input.limitations,
          "Demo test sayıları varsayımdır; gerçek ürün başarısını kanıtlamaz.",
          ...r.snapshot.steps
            .filter((x) => x.output?.error)
            .map((x) => `${x.stepId}: ${x.output.error.message}`),
        ]),
      ],
    };
  }
  status(content, memory) {
    if (
      [content.buildSuggestion, content.testResults].some(
        (x) => x.status !== "completed",
      )
    )
      return "failed";
    return [content.memoryContext, content.research, memory].every(
      (x) => x.status === "completed",
    )
      ? "completed"
      : "partial";
  }
  async persistAndFinish(id, signal) {
    const content = this.content(id),
      r = this.get(id);
    const input = {
      runId: id,
      namespace: r.input.mode,
      analysisStatus: this.status(content, { status: "completed" }),
      analysis: content,
      lessons: content.testResults.data?.evaluation.limitations || [],
    };
    schema("MemoryUpdateInput", input);
    if (this.step(id, "memory.update").status === "pending")
      await this.call(
        id,
        "memory.update",
        "memoryUpdate",
        input,
        signal,
        (out) => {
          if (
            out.data &&
            (out.data.namespace !== r.input.mode || out.data.recordId !== id)
          )
            throw new AppError(
              "INVALID_OUTPUT",
              "Hafıza receipt kimliği uyuşmuyor.",
            );
        },
      );
    await this.mutate(id, (r, emit) => {
      const content = this.content(id);
      const memoryUpdate = r.snapshot.steps.find(
        (x) => x.stepId === "memory.update",
      ).output;
      const finishedAt = now();
      const result = {
        schemaVersion: VERSION,
        runId: id,
        status: this.status(content, memoryUpdate),
        createdAt: r.createdAt,
        finishedAt,
        durationMs: Date.parse(finishedAt) - Date.parse(r.createdAt),
        ...content,
        memoryUpdate,
      };
      invariant(() => checks.checkResponse(result));
      r.snapshot.status = result.status;
      r.snapshot.result = result;
      const e = emit(
        "run.finished",
        { result },
        "Analiz tamamlandı; kayıt girişimi sonuçlandı.",
      );
      result.finishedAt = e.timestamp;
      result.durationMs =
        Date.parse(e.timestamp) - Date.parse(result.createdAt);
      e.payload.result = structuredClone(result);
    });
  }
  async recover(
    id,
    error = new AppError(
      "RUN_INTERRUPTED",
      "Sunucu yeniden başlatıldığı için işlem kesildi.",
      502,
      true,
    ),
  ) {
    const r = this.get(id);
    if (final.has(r.snapshot.status)) return;
    for (const s of r.snapshot.steps.filter(
      (x) => x.stepId !== "memory.update",
    )) {
      if (s.status === "running")
        await this.endStep(id, s.stepId, failure(error));
      else if (s.status === "pending")
        await this.endStep(id, s.stepId, skipped());
    }
    if (this.step(id, "memory.update").status === "running")
      await this.endStep(id, "memory.update", failure(error));
    await this.persistAndFinish(id);
  }
}
module.exports = { Orchestrator, specs, terminal, final };
