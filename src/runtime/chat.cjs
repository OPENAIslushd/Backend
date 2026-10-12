const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { runCli } = require("./cli.cjs");
const { VERSION, AppError, duplicate, now } = require("./core.cjs");
const replySchema = {
  type: "object",
  properties: { reply: { type: "string", minLength: 1 } },
  required: ["reply"],
  additionalProperties: false,
};
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
  },
  required: ["schemaVersion", "clientRequestId", "message"],
  additionalProperties: false,
});
const instructions = `You are Codex, a helpful, knowledgeable assistant chatting with a user inside their app, like ChatGPT.
Reply to the user's latest message as a conversation partner: answer questions, follow requests, and when the user shares a statement, idea, or description, engage with its substance (give feedback, insights, suggestions, or ask a useful follow-up question). Never just rephrase or rewrite their message unless they explicitly ask you to.
Reply in the language of the user's latest message. Be concise but substantive. Plain text; simple lists are fine.
You have no tools here: do not run commands, inspect files, or modify anything.
Put your full answer in the "reply" field of the JSON output.`;
// Plain-text transcript reads as a chat; a JSON envelope made the model edit the message instead of answering it.
function transcript({ history = [], message }) {
  const turns = [...history, { role: "user", content: message }]
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}:\n${m.content}`)
    .join("\n\n");
  return `${instructions}\n\n--- Conversation ---\n\n${turns}\n\nAssistant:`;
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
          const response = {
            schemaVersion: VERSION,
            clientRequestId: request.clientRequestId,
            origin: "live",
            reply: value.reply,
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
module.exports = { CliChat };
