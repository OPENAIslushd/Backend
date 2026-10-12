"use strict";
const $ = (id) => document.getElementById(id);
let busy = false,
  retry = null;
const messages = [];
function render() {
  if (!messages.length) return;
  $("messages").replaceChildren(
    ...messages.map((message) => {
      const el = document.createElement("div");
      el.className = "bubble " + message.role;
      const label = document.createElement("span");
      label.className = "speaker";
      label.textContent = message.role === "user" ? "SEN" : "CODEX · CANLI";
      const content = document.createElement("span");
      content.textContent = message.content;
      el.append(label, content);
      return el;
    }),
  );
  $("messages").scrollTop = $("messages").scrollHeight;
}
$("prompt-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("prompt").value.trim();
  if (busy || !text) return;
  busy = true;
  for (const id of ["send", "prompt", "example", "clear-chat"])
    $(id).disabled = true;
  $("send").textContent = "Codex yanıtlıyor…";
  $("error").hidden = true;
  if (!retry || retry.message !== text) {
    retry = {
      schemaVersion: "4.0.0",
      clientRequestId: crypto.randomUUID(),
      message: text,
      // Last 20 turns give the model conversation context.
      history: messages
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) })),
    };
    messages.push({ role: "user", content: text });
    render();
  }
  try {
    const response = await fetch("/cli/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(retry),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error?.message || "CLI çağrısı tamamlanamadı.");
    messages.push({ role: "assistant", content: data.reply });
    $("prompt").value = "";
    retry = null;
    render();
  } catch (error) {
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    busy = false;
    for (const id of ["send", "prompt", "example", "clear-chat"])
      $(id).disabled = false;
    $("send").textContent = "Codex’e gönder ↑";
    $("prompt").focus();
  }
});
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("prompt-form").requestSubmit();
  }
});
$("example").onclick = () => {
  $("prompt").value =
    "Merhaba! Bana bir yemek planlama uygulaması için üç basit MVP özelliği öner.";
  $("prompt").focus();
};
$("clear-chat").onclick = () => {
  messages.length = 0;
  retry = null;
  $("messages").replaceChildren();
  $("prompt").value = "";
  $("error").hidden = true;
  $("prompt").focus();
};
