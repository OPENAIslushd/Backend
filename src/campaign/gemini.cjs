// Research through the public gemini.google.com page, driven by Playwright with the installed Chrome.
// No sign-in. If Google shows a consent page, the privacy-preserving "Reject all" option is chosen.
// A CAPTCHA or "unusual traffic" page is never bypassed: research fails and the catalog fallback runs.
const { AppError } = require("../runtime/core.cjs");
const GEMINI_URL = "https://gemini.google.com/app";
function prompt(p) {
  const lines = [
    `İşletme: ${p.name}`,
    p.productName && `Ürün: ${p.productName}`,
    `Ne yapıyor: ${p.description}`,
    `Hedef kitle: ${p.audience}`,
    `Pazar: ${p.region}`,
    p.topic && `Kategori: ${p.topic}`,
    p.url && `Web sitesi: ${p.url}`,
  ].filter(Boolean);
  return `Bir reklam kampanyası planı için rakip araştırması yap. Güncel web bilgisini kullan.
${lines.join("\n")}

Bu işletmenin bu pazardaki en önemli 3-5 doğrudan rakibini bul. Bilmediğin bilgiyi uydurma; emin değilsen null yaz.
Yanıtı YALNIZ aşağıdaki biçimde tek bir JSON nesnesi olarak ver, başka metin ekleme:
{"market_summary":"pazarın 2-3 cümlelik Türkçe özeti","competitors":[{"name":"","url":"resmi site","summary":"2-3 cümlelik Türkçe özet","strengths":["öne çıkan özellik"],"pricing":"bilinen fiyat bilgisi veya null","sources":["ziyaret ettiğin kaynak URL"]}]}`;
}
const httpUrl = (u) =>
  typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u.trim())
    ? u.trim()
    : null;
const str = (v, max) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
// Gemini output is untrusted text: take the first JSON object and keep only well-formed fields.
function parseAnswer(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("JSON yok");
  let depth = 0,
    inString = false,
    escaped = false,
    end = -1;
  for (let i = start; i < text.length && end < 0; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) end = i;
  }
  const raw = JSON.parse(text.slice(start, end + 1));
  const competitors = (Array.isArray(raw.competitors) ? raw.competitors : [])
    .map((c) => ({
      name: str(c?.name, 120),
      url: httpUrl(c?.url),
      summary: str(c?.summary, 1000),
      strengths: (Array.isArray(c?.strengths) ? c.strengths : [])
        .map((s) => str(s, 200))
        .filter(Boolean)
        .slice(0, 5),
      pricing: str(c?.pricing, 300),
      sources: (Array.isArray(c?.sources) ? c.sources : [])
        .map(httpUrl)
        .filter(Boolean)
        .slice(0, 5),
    }))
    .filter((c) => c.name && c.summary)
    .slice(0, 6);
  if (!competitors.length) throw new Error("rakip yok");
  return { summary: str(raw.market_summary, 1500), competitors };
}
function geminiClient({
  channel = process.env.GEMINI_BROWSER_CHANNEL || "chrome",
  headless = process.env.GEMINI_HEADED !== "1",
  timeoutMs = 90000,
} = {}) {
  return {
    name: "gemini",
    async research(profile, signal) {
      let chromium;
      try {
        ({ chromium } = require("playwright-core"));
      } catch {
        throw new AppError(
          "TOOL_UNAVAILABLE",
          "playwright-core yüklü değil (npm ci).",
          502,
          true,
        );
      }
      let browser;
      const abort = () => browser?.close().catch(() => {});
      signal?.addEventListener("abort", abort, { once: true });
      const deadline = Date.now() + timeoutMs;
      try {
        browser = await chromium.launch({ channel, headless });
        const page = await browser.newPage({ locale: "tr-TR" });
        await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
        if (page.url().includes("consent.")) {
          await page
            .getByRole("button", { name: /Reject all|Tümünü reddet/i })
            .first()
            .click();
          await page.waitForURL(/gemini\.google\.com/);
        }
        if (/sorry|captcha|unusual/i.test(page.url()))
          throw new AppError(
            "TOOL_UNAVAILABLE",
            "Google otomatik erişimi engelledi (doğrulama sayfası).",
            502,
            true,
          );
        const box = page.getByRole("textbox").first();
        await box.waitFor({ timeout: 20000 });
        await box.fill(prompt(profile));
        await page.keyboard.press("Enter");
        // The answer streams in; it is done when the last response text stops changing.
        let last = "",
          stable = 0;
        while (Date.now() < deadline) {
          await page.waitForTimeout(1000);
          const texts = await page
            .locator("model-response message-content")
            .allInnerTexts()
            .catch(() => []);
          const current = texts.at(-1) || "";
          if (current && current === last) {
            if (++stable >= 3) break;
          } else stable = 0;
          last = current;
        }
        if (!last)
          throw new AppError("TIMEOUT", "Gemini yanıt vermedi.", 504, true);
        try {
          return { provider: "gemini", ...parseAnswer(last) };
        } catch (e) {
          throw new AppError(
            "INVALID_OUTPUT",
            `Gemini yanıtı okunamadı (${e.message}).`,
          );
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(
          "TOOL_UNAVAILABLE",
          `Gemini araştırması başarısız: ${e.message.split("\n")[0]}`,
          502,
          true,
        );
      } finally {
        signal?.removeEventListener("abort", abort);
        await browser?.close().catch(() => {});
      }
    },
  };
}
module.exports = { geminiClient, parseAnswer, prompt };
