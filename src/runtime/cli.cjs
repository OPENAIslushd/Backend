const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { AppError } = require("./core.cjs");
// Inline local and URN references for the CLI's standalone JSON schema file.
function outputSchema(group, type) {
  const schemas = Object.fromEntries(
    ["analysis", "intake", "events", "memory"].map((g) => {
      const s = require(`../../contracts/${g}.schema.json`);
      return [s.$id, s];
    }),
  );
  const root = schemas[`urn:slushd:${group}:4.0.0`];
  function walk(v, base) {
    if (Array.isArray(v)) return v.map((x) => walk(x, base));
    if (!v || typeof v !== "object") return v;
    if (v.$ref) {
      const [id, fragment] = v.$ref.split("#");
      const doc = id ? schemas[id] : base;
      const target = fragment
        .split("/")
        .slice(1)
        .reduce((o, k) => o[k], doc);
      return walk(target, doc);
    }
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !["$id", "$schema", "$defs"].includes(k))
        // Contract unions discriminate by status; strict model output accepts anyOf,
        // not oneOf. The original contract is rechecked at the adapter boundary.
        .map(([k, x]) => [k === "oneOf" ? "anyOf" : k, walk(x, base)]),
    );
  }
  return walk(root.$defs[type], root);
}
async function runCli({
  role,
  prompt,
  input,
  text,
  outputSchema: shape,
  signal,
  timeoutMs = 30000,
  command = process.env.CODEX_BIN || process.env.CODEX_CLI_PATH || "codex",
  model = process.env.CODEX_MODEL,
  effort,
  args,
  maxOutputBytes = 1024 * 1024,
}) {
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(shape);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slushd-cli-"));
  const schemaFile = path.join(dir, "schema.json"),
    out = path.join(dir, "output.json");
  await fs.writeFile(schemaFile, JSON.stringify(shape));
  // No shell, no API key, no inherited MCP tools for intake extraction. Team adapters own tool access.
  const argv = args || [
    "exec",
    ...(model ? ["--model", model] : []),
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    "--ignore-user-config",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--output-schema",
    schemaFile,
    "--output-last-message",
    out,
    "-",
  ];
  try {
    return await new Promise((resolve, reject) => {
      if (signal?.aborted)
        return reject(new AppError("TIMEOUT", "CLI iptal edildi.", 504, true));
      const child = spawn(command, argv, {
        cwd: dir,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      let size = 0,
        stdout = "",
        stderrTail = "",
        failure = null,
        killTimer;
      let timer;
      const kill = () => {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch {}
      };
      const stop = (e) => {
        if (failure) return;
        failure = e;
        try {
          if (process.platform === "win32") child.kill("SIGTERM");
          else process.kill(-child.pid, "SIGTERM");
        } catch {}
        killTimer = setTimeout(kill, 100);
      };
      const abort = () =>
        stop(new AppError("TIMEOUT", "CLI iptal edildi.", 504, true));
      const clean = () => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
      };
      timer = setTimeout(
        () =>
          stop(new AppError("TIMEOUT", "CLI süre sınırını aştı.", 504, true)),
        timeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
      const consume = (chunk, capture) => {
        size += chunk.length;
        if (!capture) stderrTail = (stderrTail + chunk.toString()).slice(-4096);
        if (size > maxOutputBytes)
          stop(
            new AppError("INVALID_OUTPUT", "CLI çıktı boyutu sınırını aştı."),
          );
        else if (capture) stdout += chunk;
      };
      child.stdout.on("data", (x) => consume(x, true));
      child.stderr.on("data", (x) => consume(x, false));
      child.stdin.on("error", () => {});
      child.on("error", () => {
        clean();
        reject(
          new AppError("TOOL_UNAVAILABLE", "CLI başlatılamadı.", 502, true),
        );
      });
      child.on("close", async (code) => {
        clean();
        if (failure) {
          kill();
          return reject(failure);
        }
        if (code !== 0 && /429|Too Many Requests/i.test(stderrTail))
          return reject(
            new AppError(
              "BUSY",
              "CLI kullanım sınırına ulaştı; daha sonra deneyin.",
              429,
              true,
            ),
          );
        if (code !== 0)
          return reject(
            new AppError(
              "TOOL_UNAVAILABLE",
              "CLI başarısız çıkış yaptı.",
              502,
              true,
            ),
          );
        try {
          let raw;
          if (args) raw = stdout;
          else {
            if ((await fs.stat(out)).size > maxOutputBytes) throw new Error();
            raw = await fs.readFile(out, "utf8");
          }
          const value = JSON.parse(raw);
          if (!validate(value)) throw new Error();
          resolve(value);
        } catch {
          reject(
            new AppError(
              "INVALID_OUTPUT",
              "CLI geçerli şema çıktısı üretmedi.",
            ),
          );
        }
      });
      // Chat callers pass a ready plain-text transcript; agents keep the JSON envelope.
      child.stdin.end(
        text ?? JSON.stringify({ role, instructions: prompt, input }),
      );
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
module.exports = { runCli, outputSchema };
