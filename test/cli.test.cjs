const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { runCli, outputSchema } = require("../src/runtime/cli.cjs");
const shape = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
const invoke = (code, options = {}) =>
  runCli({
    role: "test",
    prompt: "Return JSON",
    input: {},
    outputSchema: shape,
    command: process.execPath,
    args: ["-e", code],
    ...options,
  });
test("CLI parses only valid schema JSON", async () => {
  assert.deepEqual(
    await invoke(
      "process.stdin.resume();process.stdout.write(JSON.stringify({ok:true}));",
    ),
    { ok: true },
  );
  await assert.rejects(invoke('console.log("not json")'), {
    code: "INVALID_OUTPUT",
  });
  await assert.rejects(invoke('console.log("{}")'), { code: "INVALID_OUTPUT" });
});
test("CLI nonzero, missing executable and output overflow are controlled", async () => {
  await assert.rejects(invoke("process.exit(7)"), { code: "TOOL_UNAVAILABLE" });
  await assert.rejects(invoke("", { command: "/nonexistent/slushd-cli" }), {
    code: "TOOL_UNAVAILABLE",
  });
  await assert.rejects(
    invoke('console.log("x".repeat(10000))', { maxOutputBytes: 100 }),
    { code: "INVALID_OUTPUT" },
  );
});
test("CLI timeout and cancellation terminate actual subprocesses", async () => {
  await assert.rejects(invoke("setInterval(()=>{},1000)", { timeoutMs: 40 }), {
    code: "TIMEOUT",
  });
  const c = new AbortController();
  const p = invoke("setInterval(()=>{},1000)", { signal: c.signal });
  setTimeout(() => c.abort(), 40);
  await assert.rejects(p, { code: "TIMEOUT" });
});
test("CLI stdin treats prompt data as literal data", async () => {
  const out = await runCli({
    role: "test",
    prompt: "literal",
    input: { text: "$(touch /tmp/do-not-create) `echo nope`" },
    outputSchema: shape,
    command: process.execPath,
    args: [
      "-e",
      'let x="";process.stdin.on("data",d=>x+=d);process.stdin.on("end",()=>console.log(JSON.stringify({ok:JSON.parse(x).input.text.includes("$(")})));',
    ],
  });
  assert.equal(out.ok, true);
});
test("standalone schemas resolve all local and URN refs", () => {
  const s = outputSchema("intake", "ExtractOutput");
  assert(!JSON.stringify(s).includes("$ref"));
  assert(s.properties.product.properties.pricing);
});

test("CLI rate limit is a controlled retryable error without raw logs", async () => {
  await assert.rejects(
    invoke(
      'console.error("ERROR 429 Too Many Requests secret-log");process.exit(1)',
    ),
    (error) =>
      error.code === "BUSY" &&
      error.retryable &&
      !error.message.includes("secret-log"),
  );
});
