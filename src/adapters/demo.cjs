const { schema, done, now, AppError, same } = require("../runtime/core.cjs");
const fixture = require("../../contracts/examples/analyze.demo.response.json");
const specialists = {
  risk_reward: ["riskReward", "RiskRewardResult"],
  marketing: ["marketing", "MarketingResult"],
  rivals: ["rivals", "RivalsResult"],
  trends: ["trends", "TrendsResult"],
};
// Fixture adapters only. No Research/Strategy/Simulator business logic is implemented here.
function demoAdapters(store) {
  return {
    supports(input) {
      return (
        input.mode === "demo" &&
        Object.entries(input.product).every(
          ([key, field]) =>
            field.status !== "provided" ||
            same(field.value, fixture.input.product[key].value),
        )
      );
    },
    async research({ input }, { onStep, signal }) {
      signal.throwIfAborted();
      for (const [task, [key]] of Object.entries(specialists)) {
        await onStep({ task, status: "running" });
        await onStep({
          task,
          status: "finished",
          output: structuredClone(fixture.research.data[key]),
        });
      }
      return structuredClone(fixture.research);
    },
    async memoryRead({ namespace }) {
      return done({ namespace, similarIdeas: [], matchMethod: "none" });
    },
    async strategy() {
      return structuredClone(fixture.buildSuggestion);
    },
    async simulate({ buildSuggestion }) {
      if (!same(buildSuggestion, fixture.buildSuggestion.data))
        throw new AppError(
          "INVALID_OUTPUT",
          "Demo Simulator yalnız sabit demo test planını destekler.",
        );
      return { ...structuredClone(fixture.testResults), origin: "mock" };
    },
    async memoryUpdate(input, { signal }) {
      signal.throwIfAborted();
      return store.serial("memory-" + input.runId, async () => {
        const file = `memory/${input.namespace}/${input.runId}.json`;
        const old = await store.read(file);
        if (
          old &&
          same(old.analysis, input.analysis) &&
          same(old.lessons, input.lessons) &&
          old.analysisStatus === input.analysisStatus
        )
          return done({
            namespace: old.namespace,
            recordId: old.recordId,
            revision: old.revision,
            updatedAt: old.updatedAt,
          });
        const timestamp = now();
        const record = {
          schemaVersion: "4.0.0",
          recordId: input.runId,
          namespace: input.namespace,
          revision: (old?.revision || 0) + 1,
          createdAt: old?.createdAt || timestamp,
          updatedAt: timestamp,
          analysisStatus: input.analysisStatus,
          analysis: input.analysis,
          lessons: input.lessons,
        };
        schema("MemoryRecord", record);
        signal.throwIfAborted();
        await store.write(file, record);
        return done({
          namespace: record.namespace,
          recordId: record.recordId,
          revision: record.revision,
          updatedAt: record.updatedAt,
        });
      });
    },
  };
}
module.exports = { demoAdapters, specialists };
