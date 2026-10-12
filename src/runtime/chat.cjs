const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { runCli } = require("./cli.cjs");
const { VERSION, AppError, duplicate, now } = require("./core.cjs");
// Campaign profile the chat fills in as the user talks; it feeds POST /campaigns.
const TEXT_FIELDS = {
  name: 120,
  productName: 120,
  description: 2000,
  audience: 500,
  region: 200,
  topic: 200,
  url: 500,
};
const REQUIRED = ["name", "description", "audience", "region"];
const nullable = (type) => ({ type: [type, "null"] });
const profileShape = {
  type: "object",
  properties: {
    ...Object.fromEntries(
      Object.keys(TEXT_FIELDS).map((k) => [k, nullable("string")]),
    ),
    budget: nullable("number"),
    currency: nullable("string"),
    unitContribution: nullable("number"),
  },
  required: [
    ...Object.keys(TEXT_FIELDS),
    "budget",
    "currency",
    "unitContribution",
  ],
  additionalProperties: false,
};
// Strict model output: every key required, unknown values are null.
const replySchema = {
  type: "object",
  properties: {
    reply: { type: "string", minLength: 1 },
    profile: profileShape,
    generate: { type: "boolean" },
  },
  required: ["reply", "profile", "generate"],
  additionalProperties: false,
};
const emptyProfile = () =>
  Object.fromEntries(profileShape.required.map((k) => [k, null]));
// Model output is untrusted: keep only well-formed values within the campaign limits.
function cleanProfile(raw = {}) {
  const p = emptyProfile();
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    const v = typeof raw[k] === "string" ? raw[k].trim() : "";
    if (v) p[k] = v.slice(0, max);
  }
  if (p.url && !/^https?:\/\//i.test(p.url)) p.url = null;
  const c =
    typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
  if (/^[A-Z]{3}$/.test(c)) p.currency = c;
  if (Number.isFinite(raw.budget) && raw.budget >= 1 && raw.budget <= 1e9)
    p.budget = raw.budget;
  if (
    Number.isFinite(raw.unitContribution) &&
    raw.unitContribution >= 0 &&
    raw.unitContribution <= 1e6
  )
    p.unitContribution = raw.unitContribution;
  return p;
}
const missingFields = (p) => REQUIRED.filter((k) => !p[k]);
const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validate = ajv.compile({
  type: "object",
  properties: {
    schemaVersion: { const: VERSION },
    clientRequestId: { type: "string", format: "uuid" },
    message: { type: "string", minLength: 1, maxLength: 4000 },
    history: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          role: { enum: ["user", "assistant"] },
          content: { type: "string", minLength: 1, maxLength: 8000 },
        },
        required: ["role", "content"],
        additionalProperties: false,
      },
    },
    profile: { type: "object" },
  },
  required: ["schemaVersion", "clientRequestId", "message"],
  additionalProperties: false,
});
const instructions = `You are Codex inside Orchestrator, an assistant that helps a business owner plan a 30-day advertising campaign (paid social, paid search, influencer).
Talk naturally: answer questions, give useful feedback on their business, and ask for missing details one or two at a time. Never just rephrase the user's message.
While chatting, keep the campaign profile up to date in the "profile" output field:
- name: business name; productName: product being advertised; description: what the business/product does; audience: target customers; region: target market/country; topic: product category for competitor research (e.g. "Görev yönetimi", "E-ticaret", "Web analitiği"); url: website.
- budget: 30-day ad budget as a number; currency: 3-letter ISO code (e.g. TRY, USD); unitContribution: profit per sale after variable costs, as a number.
- Fill a field only from what the user said or clearly implied. Never invent facts. Keep earlier values unless the user changes them. Use null for unknown.
- Required before a strategy can be generated: name, description, audience, region. Budget, currency and unitContribution are optional; if missing they are estimated with labelled mock assumptions.
When the required fields are filled, tell the user they can ask you to generate the strategy. Set "generate" to true only when the user asks to generate/create/run the strategy (e.g. "strateji üret") and the required fields are filled; otherwise false.
Reply in the language of the user's latest message. Be concise. Plain text; simple lists are fine.
You have no tools here: do not run commands, inspect files, or modify anything.`;
// Plain-text transcript reads as a chat; a JSON envelope made the model edit the message instead of answering it.
function transcript({ history = [], message, profile }) {
  const turns = [...history, { role: "user", content: message }]
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}:\n${m.content}`)
    .join("\n\n");
  return `${instructions}\n\n--- Current campaign profile ---\n${JSON.stringify(cleanProfile(profile), null, 2)}\n\n--- Conversation ---\n\n${turns}\n\nAssistant:`;
}
class CliChat {
  constructor(store, { runner = runCli, timeoutMs = 60000 } = {}) {
    Object.assign(this, { store, runner, timeoutMs });
    this.active = null;
  }
  async send(request) {
    if (!validate(request) || !request.message.trim())
      throw new AppError(
        "INVALID_REQUEST",
        "Prompt 1–4000 karakter olmalı.",
        400,
      );
    let job;
    await this.store.serial("cli-chat-dispatch", async () => {
      const file = `cli-chat/${request.clientRequestId}.json`;
      const saved = await this.store.read(file);
      if (saved) {
        duplicate(saved.request, request);
        job = Promise.resolve(saved.response);
        return;
      }
      if (this.active) {
        if (this.active.request.clientRequestId === request.clientRequestId) {
          duplicate(this.active.request, request);
          job = this.active.job;
          return;
        }
        throw new AppError(
          "BUSY",
          "Bir CLI yanıtı hazırlanıyor. Bitince tekrar deneyin.",
          429,
          true,
        );
      }
      job = Promise.resolve()
        .then(async () => {
          const value = await this.runner({
            role: "local-chat",
            text: transcript(request),
            outputSchema: replySchema,
            timeoutMs: this.timeoutMs,
          });
          if (!value || typeof value.reply !== "string" || !value.reply.trim())
            throw new AppError("INVALID_OUTPUT", "CLI boş yanıt döndürdü.");
          const profile = cleanProfile(value.profile || request.profile);
          const missing = missingFields(profile);
          const response = {
            schemaVersion: VERSION,
            clientRequestId: request.clientRequestId,
            origin: "live",
            reply: value.reply,
            profile,
            missing,
            ready: missing.length === 0,
            generate: value.generate === true && missing.length === 0,
            createdAt: now(),
          };
          await this.store.write(file, { request, response });
          return response;
        })
        .finally(() => {
          if (this.active?.job === job) this.active = null;
        });
      job.catch(() => {});
      this.active = { request: structuredClone(request), job };
    });
    return job;
  }
  async idle() {
    await this.active?.job.catch(() => {});
  }
}
module.exports = { CliChat, cleanProfile, missingFields };
