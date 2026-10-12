const { randomUUID } = require("node:crypto");
const base = process.env.BASE_URL || "http://127.0.0.1:3001";
const post = async (p, body) => {
  const r = await fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(out));
  return out;
};
async function until(id, status) {
  for (let i = 0; i < 300; i++) {
    const r = await (await fetch(`${base}/analyses/${id}`)).json();
    if (status.includes(r.status)) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Smoke timeout");
}
(async () => {
  let s = await post("/intakes", {
    ...require("../contracts/examples/intake.create.request.json"),
    clientRequestId: randomUUID(),
  });
  s = await post(`/intakes/${s.intakeId}/messages`, {
    schemaVersion: "4.0.0",
    clientMessageId: randomUUID(),
    expectedRevision: s.revision,
    action: "continue_with_unknowns",
    message: null,
  });
  const a = await post("/analyze", {
    schemaVersion: "4.0.0",
    clientRequestId: randomUUID(),
    intakeId: s.intakeId,
    intakeRevision: s.revision,
  });
  const review = await until(a.runId, ["awaiting_approval"]);
  console.log(
    "Approval gate:",
    review.status,
    "revision",
    review.review.revision,
  );
  await post(`/analyses/${a.runId}/approval`, {
    schemaVersion: "4.0.0",
    clientRequestId: randomUUID(),
    reviewRevision: review.review.revision,
    decision: "approve",
  });
  const end = await until(a.runId, ["completed", "partial", "failed"]);
  console.log(
    JSON.stringify(
      {
        runId: a.runId,
        status: end.status,
        memory: end.result.memoryUpdate.status,
        lastSequence: end.lastSequence,
      },
      null,
      2,
    ),
  );
  if (end.status !== "completed") process.exitCode = 1;
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
