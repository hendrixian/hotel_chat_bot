const fetch = require("./fetch");

const DEBUG_LLM = /^(1|true|yes)$/i.test(process.env.DEBUG_LLM || "");

function debug(...args) {
  if (DEBUG_LLM) {
    console.log("[llm]", ...args);
  }
}

function summarizeBody(body) {
  if (!body || typeof body !== "object") return body;
  const summary = { ...body };

  if (typeof summary.prompt === "string") {
    summary.prompt = `[prompt ${summary.prompt.length} chars]`;
  }
  if (typeof summary.text === "string") {
    summary.text = `[text ${summary.text.length} chars]`;
  }
  if (Array.isArray(summary.messages)) {
    summary.messages = `[messages ${summary.messages.length}]`;
  }

  return summary;
}

const COLAB_SUFFIXES = ["/generate", "/translate", "/intent", "/rewrite"];

function buildColabUrl(path = "") {
  const raw = process.env.COLAB_URL;
  if (!raw) {
    throw new Error("COLAB_URL is not set");
  }

  let base = raw.trim().replace(/\/+$/, "");
  for (const suffix of COLAB_SUFFIXES) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }

  if (!path) return base;
  if (base.endsWith(path)) return base;
  return `${base}${path}`;
}

function buildColabHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.COLAB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function postJson(url, body, headers) {
  debug("POST", url, summarizeBody(body));
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    debug("HTTP", res.status, text.slice(0, 500));
    throw new Error(`Request failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function callColabLLM({ prompt, maxTokens = 512, temperature = 0.2 }) {
  const url = buildColabUrl("/generate");
  debug("Colab generate URL", url);
  const data = await postJson(
    url,
    { prompt, max_tokens: maxTokens, temperature },
    buildColabHeaders()
  );
  return data.text || data.response || data.generated_text || "";
}

async function callColabTranslate({ text, sourceLang = "mya_Mymr", targetLang = "eng_Latn" }) {
  const url = buildColabUrl("/translate");
  debug("Colab translate URL", url);
  const data = await postJson(
    url,
    { text, source_lang: sourceLang, target_lang: targetLang },
    buildColabHeaders()
  );
  return data.text || data.translation || data.translated_text || "";
}

async function callColabIntent({ text }) {
  const url = buildColabUrl("/intent");
  debug("Colab intent URL", url);
  const data = await postJson(url, { text }, buildColabHeaders());
  return data.intent || data.text || data.label || "";
}

async function callColabRewrite({ text }) {
  const url = buildColabUrl("/rewrite");
  debug("Colab rewrite URL", url);
  const data = await postJson(url, { text }, buildColabHeaders());
  return data.text || data.rewrite || data.output || "";
}

async function callBurmeseAIRewrite({ text }) {
  const url = process.env.BURMESE_AI_URL;
  if (!url) {
    return callColabRewrite({ text });
  }

  const headers = { "Content-Type": "application/json" };
  const token = process.env.BURMESE_AI_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const data = await postJson(url, { text }, headers);
  return data.text || data.rewrite || data.output || "";
}

async function callOllama({ prompt, model = "mistral" }) {
  const url = process.env.OLLAMA_URL || "http://localhost:11434";
  debug("Ollama generate", { url, model, prompt: `[prompt ${prompt.length} chars]` });
  const res = await fetch(`${url.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false })
  });

  if (!res.ok) {
    const text = await res.text();
    debug("Ollama HTTP", res.status, text.slice(0, 500));
    throw new Error(`Ollama error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.response || "";
}

module.exports = {
  callColabLLM,
  callColabTranslate,
  callColabIntent,
  callBurmeseAIRewrite,
  callOllama
};
