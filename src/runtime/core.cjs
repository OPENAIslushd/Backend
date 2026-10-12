const { validate, typeId, ...checks } = require("../../contracts/validate.cjs");
const VERSION = "4.0.0";
class AppError extends Error {
  constructor(code, message, status = 502, retryable = false) {
    super(message);
    Object.assign(this, { code, status, retryable });
  }
}
function schema(type, value, group = "analysis", code = "INVALID_OUTPUT") {
  try {
    validate(
      `urn:slushd:${group}:${VERSION}${type ? "#/$defs/" + type : ""}`,
      value,
    );
  } catch {
    throw new AppError(
      code,
      `${group}.${type || "event"} şeması geçersiz.`,
      code === "INVALID_REQUEST" ? 400 : 502,
    );
  }
  return value;
}
function invariant(check) {
  try {
    check();
  } catch {
    throw new AppError(
      "INVALID_OUTPUT",
      "Agent çıktısı iş kurallarıyla tutarsız.",
    );
  }
}
const done = (value) => ({
  status: "completed",
  origin: "derived",
  data: value,
  error: null,
});
const skipped = () => ({
  status: "skipped",
  origin: "none",
  data: null,
  error: null,
});
function failure(error) {
  return {
    status: "failed",
    origin: "none",
    data: null,
    error: publicError(error),
  };
}
function publicError(e) {
  return e instanceof AppError
    ? { code: e.code, message: e.message, retryable: e.retryable }
    : {
        code: "TOOL_UNAVAILABLE",
        message: "Agent çağrısı tamamlanamadı.",
        retryable: true,
      };
}
const now = () => new Date().toISOString();
const same = (a, b) => require("node:util").isDeepStrictEqual(a, b);
function duplicate(saved, incoming) {
  if (!same(saved, incoming))
    throw new AppError(
      "IDEMPOTENCY_CONFLICT",
      "Aynı anahtar farklı içerikle kullanıldı.",
      409,
    );
}
// The abort signal is passed to every adapter. CLI processes additionally kill their process group.
async function bounded(fn, timeoutMs, outer) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      outer.reason || new AppError("TIMEOUT", "İşlem iptal edildi.", 504, true),
    );
  if (outer?.aborted) abort();
  else outer?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new AppError("TIMEOUT", "Agent süre sınırını aştı.", 504, true),
      ),
    timeoutMs,
  );
  let listener;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return fn(controller.signal);
      }),
      new Promise((_, reject) => {
        listener = () => reject(controller.signal.reason);
        if (controller.signal.aborted) listener();
        else
          controller.signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", listener);
  }
}
module.exports = {
  VERSION,
  AppError,
  schema,
  invariant,
  checks,
  done,
  skipped,
  failure,
  publicError,
  now,
  same,
  duplicate,
  bounded,
};
