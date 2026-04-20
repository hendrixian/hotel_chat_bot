const fetch = require("./fetch");
const { URL } = require("url");

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

function formatErrorDetails(err) {
  if (!err) return "Unknown error";
  const lines = [];
  const seen = new Set();
  let current = err;

  while (current && !seen.has(current)) {
    seen.add(current);
    const code = current.code ? `[${current.code}] ` : "";
    const message = current.message || String(current);
    lines.push(`${code}${message}`);
    current = current.cause;
  }

  return lines.join(" <- ");
}

function isNetworkFetchError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  if (err.message === "fetch failed") return true;
  const code = String(err.code || err.cause?.code || "").toUpperCase();
  return Boolean(code && /(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH)/.test(code));
}

function normalizeBaseUrl(raw, fallback) {
  const value = String(raw || fallback || "").trim();
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function buildOllamaBaseCandidates(rawUrl) {
  const normalized = normalizeBaseUrl(rawUrl, "http://localhost:11434");
  if (!normalized) {
    return ["http://localhost:11434"];
  }

  const candidates = [normalized];
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost") {
      candidates.push(normalized.replace("://localhost", "://127.0.0.1"));
      candidates.push(normalized.replace("://localhost", "://[::1]"));
    } else if (host === "127.0.0.1" || host === "::1") {
      const withLocalhost = normalized
        .replace("://127.0.0.1", "://localhost")
        .replace("://[::1]", "://localhost");
      candidates.push(withLocalhost);
    }
  } catch (_err) {
    return [normalized];
  }

  return [...new Set(candidates)];
}

const COLAB_SUFFIXES = ["/generate", "/translate", "/intent", "/rewrite"];

const COLAB_SERVICE_URL_KEYS = {
  qwen: ["COLAB_QWEN_URL", "COLAB_LLM_URL"],
  mbart: ["COLAB_MBART_URL", "COLAB_TRANSLATE_URL", "COLAB_NLLB_URL"]
};

const COLAB_SERVICE_TOKEN_KEYS = {
  qwen: ["COLAB_QWEN_TOKEN", "COLAB_LLM_TOKEN"],
  mbart: ["COLAB_MBART_TOKEN", "COLAB_TRANSLATE_TOKEN", "COLAB_NLLB_TOKEN"]
};

function pickEnvValue(keys = []) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeColabBaseUrl(raw) {
  let base = raw.trim().replace(/\/+$/, "");
  for (const suffix of COLAB_SUFFIXES) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  return base;
}

function buildColabUrl(path = "", service = "qwen") {
  const shared = pickEnvValue(["COLAB_URL"]);
  const keys = COLAB_SERVICE_URL_KEYS[service] || [];
  const raw = shared || pickEnvValue(keys);
  if (!raw) {
    const required = ["COLAB_URL", ...keys].join(" or ");
    throw new Error(`${required} is not set`);
  }

  const base = normalizeColabBaseUrl(raw);

  if (!path) return base;
  if (base.endsWith(path)) return base;
  return `${base}${path}`;
}

function buildColabHeaders(service = "qwen") {
  const headers = { "Content-Type": "application/json" };
  const sharedToken = pickEnvValue(["COLAB_TOKEN"]);
  const keys = COLAB_SERVICE_TOKEN_KEYS[service] || [];
  const token = sharedToken || pickEnvValue(keys);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttp(status, text) {
  const body = String(text || "").toLowerCase();
  if ([408, 425, 429, 500, 502, 503, 504].includes(Number(status))) {
    if (status !== 500) return true;
    return (
      body.includes("already borrowed") ||
      body.includes("temporarily") ||
      body.includes("timeout") ||
      body.includes("overload") ||
      body.includes("try again")
    );
  }
  return false;
}

async function postJson(url, body, headers) {
  debug("POST", url, summarizeBody(body));
  const retriesEnv = Number(process.env.COLAB_RETRIES);
  const maxRetries = Number.isFinite(retriesEnv) ? Math.max(0, retriesEnv) : 2;
  const baseDelayMsEnv = Number(process.env.COLAB_RETRY_DELAY_MS);
  const baseDelayMs = Number.isFinite(baseDelayMsEnv) ? Math.max(100, baseDelayMsEnv) : 350;

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isNetworkFetchError(err)) {
        const delay = baseDelayMs * (attempt + 1);
        debug("POST retry (network)", { url, attempt: attempt + 1, delay_ms: delay, error: formatErrorDetails(err) });
        await sleep(delay);
        continue;
      }
      throw new Error(`Network error calling ${url}: ${formatErrorDetails(err)}`);
    }

    if (!res.ok) {
      const text = await res.text();
      debug("HTTP", res.status, text.slice(0, 500));
      if (attempt < maxRetries && isRetryableHttp(res.status, text)) {
        const delay = baseDelayMs * (attempt + 1);
        debug("POST retry (http)", { url, status: res.status, attempt: attempt + 1, delay_ms: delay });
        await sleep(delay);
        continue;
      }
      throw new Error(`Request failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  throw new Error(`Request failed after retries: ${formatErrorDetails(lastErr)}`);
}

async function callColabLLM({ prompt, maxTokens = 512, temperature = 0.2 }) {
  const url = buildColabUrl("/generate", "qwen");
  debug("Colab generate URL", url);
  const data = await postJson(
    url,
    { prompt, max_tokens: maxTokens, temperature },
    buildColabHeaders("qwen")
  );
  return data.text || data.response || data.generated_text || "";
}

const TRANSLATION_VALUE_KEYS = [
  "text",
  "translation",
  "translated_text",
  "translatedText",
  "output",
  "content"
];

const TRANSLATION_CONTAINER_KEYS = ["data", "result", "response", "payload", "translations", "choices", "message"];

function pickTranslationText(node, depth = 0) {
  if (depth > 4 || node === null || node === undefined) return "";

  if (typeof node === "string") {
    return node.trim();
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickTranslationText(item, depth + 1);
      if (found) return found;
    }
    return "";
  }

  if (typeof node !== "object") {
    return "";
  }

  for (const key of TRANSLATION_VALUE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
    const found = pickTranslationText(node[key], depth + 1);
    if (found) return found;
  }

  for (const key of TRANSLATION_CONTAINER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
    const found = pickTranslationText(node[key], depth + 1);
    if (found) return found;
  }

  return "";
}

async function callColabTranslate({ text, sourceLang = "mya_Mymr", targetLang = "eng_Latn" }) {
  const url = buildColabUrl("/translate", "mbart");
  debug("Colab translate URL", url);
  const data = await postJson(
    url,
    { text, source_lang: sourceLang, target_lang: targetLang },
    buildColabHeaders("mbart")
  );
  return pickTranslationText(data);
}

async function callColabIntent({ text }) {
  const url = buildColabUrl("/intent", "qwen");
  debug("Colab intent URL", url);
  const data = await postJson(url, { text }, buildColabHeaders("qwen"));
  return data.intent || data.text || data.label || "";
}

async function callColabRewrite({ text }) {
  const url = buildColabUrl("/rewrite", "qwen");
  debug("Colab rewrite URL", url);
  const data = await postJson(url, { text }, buildColabHeaders("qwen"));
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
  const baseCandidates = buildOllamaBaseCandidates(process.env.OLLAMA_URL);
  debug("Ollama generate", { url: baseCandidates[0], model, prompt: `[prompt ${prompt.length} chars]` });

  let lastErr = null;
  for (const base of baseCandidates) {
    const endpoint = `${base}/api/generate`;
    try {
      const res = await fetch(endpoint, {
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
    } catch (err) {
      lastErr = err;
      const details = formatErrorDetails(err);
      debug("Ollama request failed", { endpoint, error: details });
      if (!isNetworkFetchError(err)) {
        throw err;
      }
    }
  }

  const details = formatErrorDetails(lastErr);
  throw new Error(`Ollama unreachable at ${baseCandidates.join(", ")}: ${details}`);
}

module.exports = {
  callColabLLM,
  callColabTranslate,
  callColabIntent,
  callBurmeseAIRewrite,
  callOllama
};
