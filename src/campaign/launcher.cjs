// Starts the four simulation services as child processes of the Orchestrator.
// A fresh random token and free localhost ports are chosen on every start, so no setup is needed.
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { SERVICES } = require("./clients.cjs");
const root = path.join(__dirname, "../..");
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
async function waitHealthy(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      if ((await fetch(`${url}/health`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
async function launchServices({
  dataDir,
  timeoutMs = 15000,
  log = console,
} = {}) {
  const token = randomBytes(24).toString("hex");
  const dbDir = path.join(dataDir, "simulation");
  fs.mkdirSync(dbDir, { recursive: true });
  const children = [];
  const urls = {};
  let stopping = false;
  for (const service of SERVICES) {
    const port = await freePort();
    urls[service] = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        `simulation_agents/${service}/server.js`,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PORT: String(port),
          SERVICE_TOKEN: token,
          ...(service === "memory" && {
            MEMORY_DB_PATH: path.join(dbDir, "memory.sqlite"),
          }),
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    child.stderr.on("data", (d) =>
      String(d)
        .split("\n")
        .filter(Boolean)
        .forEach((line) => log.error(`[${service}] ${line}`)),
    );
    child.on("exit", (code, signal) => {
      if (!stopping)
        log.error(
          `[${service}] durdu (${signal || code}); kampanya akışı bu servis olmadan çalışmaz.`,
        );
    });
    children.push(child);
  }
  const stop = () => {
    stopping = true;
    for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  };
  // Children must not outlive the Orchestrator, including on crashes and --watch restarts.
  process.once("exit", stop);
  const healthy = await Promise.all(
    SERVICES.map((s, i) => waitHealthy(urls[s], children[i], timeoutMs)),
  );
  const down = SERVICES.filter((_, i) => !healthy[i]);
  if (down.length)
    log.error(`Simülasyon servisleri başlamadı: ${down.join(", ")}`);
  return { token, urls, stop };
}
module.exports = { launchServices };
