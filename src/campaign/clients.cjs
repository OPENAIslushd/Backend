const { spawn } = require("node:child_process");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { AppError } = require("../runtime/core.cjs");
const SERVICES = ["memory", "strategy", "simulation", "outcome"];
const DEFAULT_PORTS = {
  memory: 8081,
  strategy: 8082,
  simulation: 8083,
  outcome: 8084,
};
function serviceConfig(env = process.env) {
  return {
    token: env.SIM_SERVICE_TOKEN || "",
    urls: Object.fromEntries(
      SERVICES.map((s) => [
        s,
        env[`SIM_${s.toUpperCase()}_URL`] ||
          `http://127.0.0.1:${DEFAULT_PORTS[s]}`,
      ]),
    ),
  };
}
// HTTP client for the four simulation services. Each action goes to its owning service.
function simulationClient(
  { token, urls } = serviceConfig(),
  { fetchImpl = fetch, timeoutMs = 180000 } = {},
) {
  async function call(action, payload, runId, signal) {
    const service = action.split(".")[0];
    if (!urls[service])
      throw new AppError("INVALID_OUTPUT", `Bilinmeyen servis: ${service}`);
    if (!token)
      throw new AppError(
        "TOOL_UNAVAILABLE",
        "SIM_SERVICE_TOKEN tanımlı değil; simülasyon servisleri çağrılamaz.",
        502,
        true,
      );
    const requestId = `req-${randomUUID()}`;
    let response;
    try {
      response = await fetchImpl(`${urls[service]}/v1/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contract_version: "1.0",
          request_id: requestId,
          run_id: runId,
          action,
          payload,
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AppError(
        "TOOL_UNAVAILABLE",
        `${service} servisine ulaşılamadı (${urls[service]}).`,
        502,
        true,
      );
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new AppError("INVALID_OUTPUT", `${service} JSON döndürmedi.`);
    }
    if (!response.ok)
      throw new AppError(
        "DEPENDENCY_FAILED",
        `${action}: ${body?.error?.message || response.status}`,
        502,
        response.status >= 500,
      );
    if (body.request_id !== requestId || body.action !== action)
      throw new AppError(
        "INVALID_OUTPUT",
        `${action} yanıt kimliği uyuşmuyor.`,
      );
    return body.data;
  }
  async function health() {
    return Object.fromEntries(
      await Promise.all(
        SERVICES.map(async (s) => {
          try {
            const r = await fetchImpl(`${urls[s]}/health`, {
              signal: AbortSignal.timeout(2000),
            });
            return [s, r.ok ? "ok" : "down"];
          } catch {
            return [s, "down"];
          }
        }),
      ),
    );
  }
  return { call, health };
}
// Runs the Python research module bridge. No shell; profile goes over stdin.
function researchClient({
  python = process.env.PYTHON_BIN || "python3",
  dir = path.join(__dirname, "../../modules/research"),
  timeoutMs = 30000,
} = {}) {
  return {
    name: "catalog",
    research(profile, signal, progress = () => {}) {
      progress("Rakip kataloğu taranıyor…");
      return new Promise((resolve, reject) => {
        const child = spawn(python, ["orchestrator_bridge.py"], {
          cwd: dir,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "";
        const fail = (message) =>
          reject(new AppError("TOOL_UNAVAILABLE", message, 502, true));
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          fail("Araştırma modülü süre sınırını aştı.");
        }, timeoutMs);
        const abort = () => child.kill("SIGKILL");
        signal?.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (x) => (out += x));
        child.stderr.resume();
        child.stdin.on("error", () => {});
        child.on("error", () => {
          clearTimeout(timer);
          fail(`Araştırma modülü başlatılamadı (${python}).`);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          let value;
          try {
            value = JSON.parse(out);
          } catch {
            return fail("Araştırma modülü geçerli JSON döndürmedi.");
          }
          if (code !== 0)
            return fail(`Araştırma modülü: ${value.error || "hata"}`);
          // Catalog facts become the same competitor shape the Gemini provider returns.
          resolve({
            provider: "catalog",
            summary: null,
            competitors: value.competitors.map((c) => ({
              name: c.name,
              url: c.url || null,
              summary: c.facts.map((f) => f.statement).join(" "),
              strengths: [],
              pricing: null,
              sources: c.sources.map((s) => s.url).filter(Boolean),
            })),
            warnings: value.warnings || [],
          });
        });
        child.stdin.end(JSON.stringify(profile));
      });
    },
  };
}
// Tries providers in order; a later one runs only when the earlier one failed.
function researchChain(providers) {
  return {
    async research(profile, signal, progress = () => {}) {
      const failures = [];
      for (const p of providers) {
        try {
          if (failures.length)
            progress(`${failures.at(-1)} — yedek kaynağa geçiliyor…`);
          const result = await p.research(profile, signal, progress);
          return failures.length
            ? { ...result, fallbackFrom: failures }
            : result;
        } catch (e) {
          failures.push(`${p.name}: ${e.message}`);
        }
      }
      throw new AppError(
        "TOOL_UNAVAILABLE",
        `Araştırma yapılamadı. ${failures.join(" · ")}`,
        502,
        true,
      );
    },
  };
}
module.exports = {
  simulationClient,
  researchClient,
  researchChain,
  serviceConfig,
  SERVICES,
};
