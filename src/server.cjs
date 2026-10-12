const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Store } = require("./runtime/store.cjs");
const { IntakeService } = require("./intake/service.cjs");
const { Orchestrator, final } = require("./orchestrator/service.cjs");
const { demoAdapters } = require("./adapters/demo.cjs");
const { VERSION, AppError, publicError } = require("./runtime/core.cjs");
const { CliChat } = require("./runtime/chat.cjs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function milliseconds(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 600000)
    throw new Error(`${name} must be 1..600000 milliseconds`);
  return value;
}
async function body(req, limit) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
    throw new AppError(
      "INVALID_REQUEST",
      "Content-Type application/json olmalı.",
      415,
    );
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      req.resume();
      throw new AppError(
        "INVALID_REQUEST",
        "JSON gövdesi boyut sınırını aştı.",
        413,
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("INVALID_REQUEST", "Geçersiz JSON gövdesi.", 400);
  }
}
const wire = (e) =>
  `id: ${e.sequence}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
async function createApp(options = {}) {
  const intakeConfig = {
    extractorMode: process.env.INTAKE_EXTRACTOR || "demo",
    timeoutMs: milliseconds("INTAKE_TIMEOUT_MS", 30000),
    ...options.intake,
  };
  if (!["demo", "cli"].includes(intakeConfig.extractorMode))
    throw new Error("INTAKE_EXTRACTOR must be demo or cli");
  const runtimeConfig = {
    timeoutMs: milliseconds("AGENT_TIMEOUT_MS", 30000),
    phaseTimeoutMs: milliseconds("PHASE_TIMEOUT_MS", 120000),
    ...options.runtime,
  };
  const store =
    options.store ||
    new Store(
      options.dataDir ||
        process.env.DATA_DIR ||
        path.join(__dirname, "../data"),
    );
  await store.init();
  const intakes = new IntakeService(store, intakeConfig);
  const cliChat = new CliChat(store, options.cliChat);
  let adapters = options.adapters || demoAdapters(store);
  if (!options.adapters && process.env.AGENT_ADAPTER_MODULE) {
    try {
      const module = await import(
        pathToFileURL(path.resolve(process.env.AGENT_ADAPTER_MODULE))
      );
      adapters = await (
        module.createAdapters || module.default?.createAdapters
      )({
        store,
        runCli: require("./runtime/cli.cjs").runCli,
      });
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  for (const name of [
    "supports",
    "research",
    "memoryRead",
    "strategy",
    "simulate",
    "memoryUpdate",
  ])
    if (typeof adapters[name] !== "function") {
      await store.close();
      throw new Error(`Adapter missing: ${name}`);
    }
  const orchestrator = new Orchestrator(
    store,
    intakes,
    adapters,
    runtimeConfig,
  );
  try {
    await orchestrator.init();
  } catch (e) {
    await store.close();
    throw e;
  }
  const allowed = new Set(
    options.origins ||
      (
        process.env.CORS_ORIGINS ||
        "http://localhost:5173,http://localhost:3000"
      ).split(","),
  );
  const streams = new Set();
  const maxBodyBytes = options.maxBodyBytes || 16384;
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const origin = req.headers.origin;
      if (origin) {
        const sameOrigin = origin === `http://${req.headers.host}`;
        if (!sameOrigin && !allowed.has(origin))
          throw new AppError("INVALID_REQUEST", "Origin izinli değil.", 403);
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Last-Event-ID",
        );
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      const url = new URL(req.url, "http://localhost"),
        parts = url.pathname.split("/").filter(Boolean);
      if (
        (parts[0] === "intakes" || parts[0] === "analyses") &&
        parts[1] &&
        !UUID.test(parts[1])
      )
        throw new AppError("NOT_FOUND", "Kayıt bulunamadı.", 404);
      const assets = {
        "/": ["index.html", "text/html; charset=utf-8"],
        "/cli": ["cli.html", "text/html; charset=utf-8"],
        "/cli.js": ["cli.js", "text/javascript; charset=utf-8"],
        "/ui.js": ["ui.js", "text/javascript; charset=utf-8"],
        "/ui.css": ["ui.css", "text/css; charset=utf-8"],
      };
      if (req.method === "GET" && Object.hasOwn(assets, url.pathname)) {
        const [file, contentType] = assets[url.pathname];
        const content = await fs.readFile(
          path.join(__dirname, "../public", file),
        );
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        });
        return res.end(content);
      }
      if (req.method === "GET" && url.pathname === "/api")
        return json(200, {
          service: "Slushd Orchestrator API",
          schemaVersion: VERSION,
          message: "Backend API çalışıyor. Yerel deneme ekranı / adresindedir.",
          health: "/health",
          endpoints: [
            "POST /cli/messages",
            "POST /intakes",
            "GET /intakes/:id",
            "POST /intakes/:id/messages",
            "POST /analyze",
            "GET /analyses/:runId",
            "GET /analyses/:runId/events",
            "POST /analyses/:runId/approval",
          ],
        });
      if (req.method === "GET" && url.pathname === "/health")
        return json(200, {
          status: "ok",
          schemaVersion: VERSION,
          agents: process.env.AGENT_ADAPTER_MODULE ? "external" : "demo",
          intakeExtractor: process.env.INTAKE_EXTRACTOR || "demo",
        });
      if (req.method === "POST" && url.pathname === "/intakes")
        return json(201, await intakes.create(await body(req, maxBodyBytes)));
      if (req.method === "POST" && url.pathname === "/cli/messages") {
        if (
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress,
          )
        )
          throw new AppError(
            "INVALID_REQUEST",
            "CLI denemesi yalnız yerel bilgisayarda kullanılabilir.",
            403,
          );
        return json(200, await cliChat.send(await body(req, maxBodyBytes)));
      }
      if (req.method === "GET" && parts[0] === "intakes" && parts.length === 2)
        return json(200, (await intakes.get(parts[1])).snapshot);
      if (
        req.method === "POST" &&
        parts[0] === "intakes" &&
        parts[2] === "messages" &&
        parts.length === 3
      )
        return json(
          200,
          await intakes.message(parts[1], await body(req, maxBodyBytes)),
        );
      if (req.method === "POST" && url.pathname === "/analyze")
        return json(
          202,
          await orchestrator.analyze(await body(req, maxBodyBytes)),
        );
      if (parts[0] === "analyses" && parts.length >= 2) {
        const id = parts[1];
        if (
          req.method === "POST" &&
          parts[2] === "approval" &&
          parts.length === 3
        )
          return json(
            200,
            await orchestrator.approve(id, await body(req, maxBodyBytes)),
          );
        if (req.method === "GET" && parts.length === 2)
          return json(200, orchestrator.get(id).snapshot);
        if (
          req.method === "GET" &&
          parts[2] === "events" &&
          parts.length === 3
        ) {
          const raw =
            req.headers["last-event-id"] ??
            url.searchParams.get("after") ??
            "0";
          const r = orchestrator.get(id);
          if (
            !/^(0|[1-9]\d*)$/.test(raw) ||
            !Number.isSafeInteger(Number(raw)) ||
            Number(raw) > r.snapshot.lastSequence
          )
            throw new AppError("INVALID_CURSOR", "SSE sırası geçersiz.", 400);
          const after = Number(raw);
          if (
            final.has(r.snapshot.status) &&
            after === r.snapshot.lastSequence
          ) {
            res.writeHead(204);
            return res.end();
          }
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          res.flushHeaders();
          let last = after;
          let timer;
          const cleanup = () => {
            clearInterval(timer);
            orchestrator.emitter.off(id, send);
            streams.delete(res);
          };
          const send = (event) => {
            if (!event) {
              cleanup();
              res.destroy();
              return;
            }
            if (event.sequence <= last) return;
            last = event.sequence;
            if (res.writableLength > 1024 * 1024) {
              cleanup();
              res.destroy();
              return;
            }
            res.write(wire(event));
            if (["run.finished", "run.cancelled"].includes(event.type)) {
              cleanup();
              res.end();
            }
          };
          // No await between reading the record, subscription and replay: no replay/live event gap.
          streams.add(res);
          orchestrator.emitter.on(id, send);
          res.on("close", cleanup);
          for (const e of r.events) if (e.sequence > after) send(e);
          if (!res.writableEnded) {
            timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
            timer.unref();
          }
          return;
        }
      }
      throw new AppError("NOT_FOUND", "Endpoint bulunamadı.", 404);
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const known =
        e instanceof AppError
          ? e
          : new AppError("STORAGE_FAILED", "İşlem tamamlanamadı.", 500, true);
      if (known.status === 429) res.setHeader("Retry-After", "1");
      json(known.status, {
        schemaVersion: VERSION,
        runId: null,
        error: publicError(known),
      });
    }
  });
  return {
    server,
    store,
    intakes,
    orchestrator,
    async listen(port = 0, host = "127.0.0.1") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return `http://${host}:${server.address().port}`;
    },
    async close() {
      for (const res of streams) res.end();
      await new Promise((resolve) =>
        server.listening ? server.close(resolve) : resolve(),
      );
      await orchestrator.idle();
      await cliChat.idle();
      await store.close();
    },
  };
}
if (require.main === module) {
  createApp()
    .then(async (app) => {
      const port = Number(process.env.PORT || 3001);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error("Invalid PORT");
      console.log(
        `Orchestrator: ${await app.listen(port, process.env.HOST || "127.0.0.1")}`,
      );
      for (const sig of ["SIGINT", "SIGTERM"])
        process.once(sig, () => app.close().then(() => process.exit(0)));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { createApp, wire };
