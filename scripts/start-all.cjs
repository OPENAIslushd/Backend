// Starts the four simulation services and the Orchestrator together for local demos.
// One shared random service token is generated per launch unless SIM_SERVICE_TOKEN is set.
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const token = process.env.SIM_SERVICE_TOKEN || randomBytes(24).toString("hex");
const dataDir = path.resolve(root, process.env.DATA_DIR || "data");
fs.mkdirSync(path.join(dataDir, "simulation"), { recursive: true });
const ports = { memory: 8081, strategy: 8082, simulation: 8083, outcome: 8084 };
const children = [];
function run(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = (stream, out) =>
    stream.on("data", (d) =>
      String(d)
        .split("\n")
        .filter(Boolean)
        .forEach((line) => out.write(`[${name}] ${line}\n`)),
    );
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[${name}] durdu (${signal || code}); hepsi kapatılıyor.`);
      stop(1);
    }
  });
  children.push(child);
}
for (const [service, port] of Object.entries(ports))
  run(
    service,
    [
      "--disable-warning=ExperimentalWarning",
      `simulation_agents/${service}/server.js`,
    ],
    {
      PORT: String(port),
      SERVICE_TOKEN: token,
      ...(service === "memory" && {
        MEMORY_DB_PATH: path.join(dataDir, "simulation", "memory.sqlite"),
      }),
    },
  );
run("orchestrator", ["--env-file-if-exists=.env", "src/server.cjs"], {
  SIM_SERVICE_TOKEN: token,
  ...Object.fromEntries(
    Object.entries(ports).map(([s, p]) => [
      `SIM_${s.toUpperCase()}_URL`,
      `http://127.0.0.1:${p}`,
    ]),
  ),
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
console.log(
  "Servisler başlatılıyor: memory 8081, strategy 8082, simulation 8083, outcome 8084, orchestrator " +
    (process.env.PORT || 3001) +
    "\nKampanya ekranı: http://127.0.0.1:" +
    (process.env.PORT || 3001) +
    "/campaign",
);
