require("dotenv").config();

const DEBUG_LLM = /^(1|true|yes)$/i.test(process.env.DEBUG_LLM || "");
const DEBUG_TRACE = /^(1|true|yes)$/i.test(process.env.DEBUG_TRACE || "");

function debug(...args) {
  if (DEBUG_LLM) {
    console.log("[chat]", ...args);
  }
}

function truncateText(text, maxLen = 500) {
  if (text === null || text === undefined) return text;
  const raw = String(text);
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}...(+${raw.length - maxLen} chars)`;
}

function makeTraceCollector() {
  const entries = [];
  const trace = (label, value) => {
    if (!DEBUG_TRACE) return;
    const safeValue = typeof value === "string" ? truncateText(value) : value;
    entries.push({ label, value: safeValue });
    if (typeof safeValue === "string") {
      console.log(`[trace] ${label}: ${safeValue}`);
    } else {
      console.log(`[trace] ${label}:`, safeValue);
    }
  };
  return { trace, entries };
}

const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const { initDb, seedIfEmpty, logMessage, getRecentMessages } = require("./db");
const { classifyIntent } = require("./router");
const { retrieveContext } = require("./retrieval");
const { getKb, getKbLocalized } = require("./kb");
const {
  callColabLLM,
  callColabTranslate,
  callColabIntent,
  callBurmeseAIRewrite,
  callOllama
} = require("./llm");
const { buildPrompt, buildRefinePrompt } = require("./prompt");

const BURMESE_UNAVAILABLE = "\u1005\u1014\u1005\u103a\u1000\u102d\u102f \u101a\u102c\u101a\u102e\u1021\u101e\u102f\u1036\u1038\u1019\u1015\u103c\u102f\u1014\u102d\u102f\u1004\u103a\u1015\u102b\u104b \u1001\u100f\u1014\u1031\u102c\u1000\u103a\u1019\u103e \u1015\u103c\u1014\u103a\u101c\u100a\u103a\u1000\u103c\u102d\u102f\u1038\u1005\u102c\u1038\u1015\u102b\u104b";
const NLLB_SRC_MY = process.env.NLLB_SRC_MY || "mya_Mymr";
const NLLB_TGT_EN = process.env.NLLB_TGT_EN || "eng_Latn";
const BURMESE_CHAR_REGEX = /[\u1000-\u109F]/;
const LATIN_CHAR_REGEX = /[A-Za-z]/;
const LLM_TRANSLATE_FALLBACK = !/^(0|false|no)$/i.test(process.env.LLM_TRANSLATE_FALLBACK || "");
const LANG_LABELS = {
  mya_Mymr: "Burmese (Myanmar)",
  eng_Latn: "English"
};

function hasLatin(text) {
  return LATIN_CHAR_REGEX.test(text || "");
}

function hasBurmese(text) {
  return BURMESE_CHAR_REGEX.test(text || "");
}

function languageLabel(code) {
  return LANG_LABELS[code] || code;
}

const REASONING_MARKERS = [
  "let me",
  "i should",
  "i need to",
  "the draft",
  "draft answer",
  "analysis",
  "thinking",
  "reasoning",
  "the user",
  "context",
  "let's",
  "i will",
  "i'll",
  "wait,"
];

function stripThink(text) {
  if (!text) return text;
  let cleaned = String(text);
  if (cleaned.includes("<think>")) {
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
    cleaned = cleaned.replace(/<think>[\s\S]*/gi, "");
  }
  return cleaned.trim();
}

function looksLikeReasoning(text) {
  const lower = String(text || "").toLowerCase();
  return REASONING_MARKERS.some((marker) => lower.includes(marker));
}

function extractFinalParagraph(text) {
  const parts = String(text || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "";

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!looksLikeReasoning(parts[i])) {
      return parts[i];
    }
  }

  return parts[parts.length - 1];
}

function cleanModelOutput(text) {
  let cleaned = stripThink(text);
  if (!cleaned) return cleaned;
  if (looksLikeReasoning(cleaned)) {
    cleaned = extractFinalParagraph(cleaned);
  }
  return cleaned.trim();
}

function cleanTranslationOutput(text) {
  let cleaned = cleanModelOutput(text);
  if (!cleaned) return cleaned;
  cleaned = cleaned.replace(/^\s*(translation|translated text|output)\s*[:\-]\s*/i, "");
  cleaned = cleaned.replace(/^[\s"]+|[\s"]+$/g, "");
  return cleaned.trim();
}

function normalizeIntentLabel(label) {
  const normalized = (label || "").toLowerCase();
  if (normalized.includes("booking") || normalized.includes("reserve") || normalized.includes("reservation")) {
    return "booking";
  }
  if (
    normalized.includes("faq") ||
    normalized.includes("policy") ||
    normalized.includes("amenity") ||
    normalized.includes("question") ||
    normalized.includes("general")
  ) {
    return "faq";
  }
  if (normalized.includes("complex")) {
    return "complex";
  }
  return "complex";
}

function detectLanguage(text) {
  if (!text) return "en";
  return BURMESE_CHAR_REGEX.test(text) ? "my" : "en";
}

async function safeTranslate(text, sourceLang, targetLang) {
  if (!text) return text;
  try {
    const translated = await callColabTranslate({ text, sourceLang, targetLang });
    if (!translated) {
      throw new Error("Empty translation response");
    }
    return translated;
  } catch (err) {
    debug("Colab translate failed", err && err.message ? err.message : err);
    return text;
  }
}

async function translateWithLLM(text, sourceLang, targetLang) {
  const prompt = [
    "You are a translation engine.",
    `Translate the text from ${languageLabel(sourceLang)} to ${languageLabel(targetLang)}.`,
    "Return only the translation without quotes or extra commentary.",
    "",
    text
  ].join("\n");
  const raw = await generateWithFallback(prompt, { maxTokens: 256, temperature: 0 });
  return cleanTranslationOutput(raw) || "";
}

async function safeTranslateWithFallback(text, sourceLang, targetLang) {
  const translated = await safeTranslate(text, sourceLang, targetLang);
  if (!translated || translated === text) {
    if (!LLM_TRANSLATE_FALLBACK) return translated || text;
    try {
      const fallback = await translateWithLLM(text, sourceLang, targetLang);
      return fallback || translated || text;
    } catch (err) {
      debug("LLM translate fallback failed", err && err.message ? err.message : err);
      return translated || text;
    }
  }
  return translated;
}

async function translateHistoryToEnglish(history) {
  if (!history || history.length === 0) return history;
  const translated = [];
  for (const msg of history) {
    if (hasBurmese(msg.content)) {
      const content = await safeTranslateWithFallback(msg.content, NLLB_SRC_MY, NLLB_TGT_EN);
      translated.push({ ...msg, content });
    } else {
      translated.push({ ...msg });
    }
  }
  return translated;
}

async function resolveIntent(message, language) {
  if (language !== "my") {
    return classifyIntent(message);
  }

  try {
    const rawIntent = await callColabIntent({ text: message });
    return normalizeIntentLabel(rawIntent);
  } catch (err) {
    return "complex";
  }
}

async function generateWithFallback(prompt, { maxTokens = 512, temperature = 0.2 } = {}) {
  try {
    return await callColabLLM({ prompt, maxTokens, temperature });
  } catch (err) {
    debug("Colab LLM failed", err && err.message ? err.message : err);
    if (process.env.OLLAMA_URL) {
      try {
        return await callOllama({ prompt, model: process.env.OLLAMA_MODEL || "mistral" });
      } catch (ollamaErr) {
        debug("Ollama failed", ollamaErr && ollamaErr.message ? ollamaErr.message : ollamaErr);
        throw ollamaErr;
      }
    }
    throw err;
  }
}

async function refineEnglishAnswer({ message, contextDocs, draft }) {
  if (!draft) return draft;
  const refinePrompt = buildRefinePrompt({ message, contextDocs, draft });
  try {
    const refined = await generateWithFallback(refinePrompt, { maxTokens: 512, temperature: 0.2 });
    return cleanModelOutput(refined) || draft;
  } catch (err) {
    debug("Refine failed", err && err.message ? err.message : err);
    return draft;
  }
}

async function startServer() {
  await initDb();
  seedIfEmpty();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/kb", (req, res) => {
    const lang = req.query?.lang === "my" ? "my" : req.query?.lang === "en" ? "en" : null;
    const kb = lang ? getKbLocalized(lang) : getKb();
    if (!kb) {
      return res.status(500).json({ error: "Knowledge base not available" });
    }
    res.json(kb);
  });

  app.post("/api/translate-ui", async (req, res) => {
    const texts = Array.isArray(req.body?.texts) ? req.body.texts : null;
    if (!texts || texts.length === 0) {
      return res.status(400).json({ error: "texts is required" });
    }

    const targetLang = req.body?.targetLang === "my" ? "my" : "en";
    if (targetLang !== "my") {
      return res.json({ texts });
    }

    const translated = [];
    for (const text of texts) {
      translated.push(await safeTranslate(String(text || ""), NLLB_TGT_EN, NLLB_SRC_MY));
    }

    res.json({ texts: translated });
  });

  app.post("/api/chat", async (req, res) => {
    const message = (req.body.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const sessionId = req.body.sessionId || uuidv4();
    const language = detectLanguage(message);

    const history = getRecentMessages(sessionId, 6);
    const intent = await resolveIntent(message, language);

    const { trace, entries } = makeTraceCollector();
    trace("user.message", message);
    trace("language.detected", language);
    trace("history.count", history.length);
    trace("intent", intent);

    let contextDocs = [];
    let replyText = "";

    try {
      if (language === "my") {
        const translatedMessage = await safeTranslateWithFallback(message, NLLB_SRC_MY, NLLB_TGT_EN);
        const translationOk = translatedMessage && !hasBurmese(translatedMessage);
        trace("translate.my->en", translatedMessage);
        trace("translate.my->en.ok", translationOk);

        if (!translationOk) {
          debug("Burmese->English translation failed; using Burmese pipeline");
        }

        const workingMessage = translationOk ? translatedMessage : message;
        const workingHistory = translationOk ? await translateHistoryToEnglish(history) : history;
        const retrievalLang = translationOk ? "en" : "my";
        const promptLang = translationOk ? "en" : "my";

        contextDocs = await retrieveContext(workingMessage, 5, retrievalLang);
        trace("context.count", contextDocs.length);

        const prompt = buildPrompt({
          message: workingMessage,
          contextDocs,
          history: workingHistory,
          language: promptLang
        });

        const draftRaw = await generateWithFallback(prompt, { maxTokens: 512, temperature: 0.2 });
        const draft = cleanModelOutput(draftRaw) || draftRaw;
        trace("draft.en.raw", draftRaw);
        trace("draft.en.clean", draft);

        if (translationOk) {
          const refinedEnglish = await refineEnglishAnswer({
            message: workingMessage,
            contextDocs,
            draft
          });
          trace("refined.en", refinedEnglish);

          const translatedBack = await safeTranslateWithFallback(refinedEnglish, NLLB_TGT_EN, NLLB_SRC_MY);
          trace("translate.en->my", translatedBack);

          try {
            replyText = await callBurmeseAIRewrite({ text: translatedBack });
            trace("rewrite.my", replyText);
          } catch (err) {
            debug("Burmese rewrite failed", err && err.message ? err.message : err);
            replyText = translatedBack;
            trace("rewrite.my", "(fallback) translation used");
          }
        } else {
          replyText = draft;
        }
      } else {
        contextDocs = await retrieveContext(message, 5, "en");
        trace("context.count", contextDocs.length);

        const prompt = buildPrompt({
          message,
          contextDocs,
          history,
          language: "en"
        });

        const draftRaw = await generateWithFallback(prompt, { maxTokens: 512, temperature: 0.2 });
        const draft = cleanModelOutput(draftRaw) || draftRaw;
        trace("draft.en.raw", draftRaw);
        trace("draft.en.clean", draft);

        replyText = await refineEnglishAnswer({ message, contextDocs, draft });
        trace("refined.en", replyText);
      }
    } catch (err) {
      debug("Chat failed", err && err.message ? err.message : err);
      replyText = language === "my"
        ? BURMESE_UNAVAILABLE
        : "Sorry, the system is temporarily unavailable. Please try again in a moment.";
    }

    logMessage(sessionId, "user", message);
    logMessage(sessionId, "assistant", replyText);

    const payload = {
      sessionId,
      intent,
      reply: replyText,
      context: contextDocs
    };

    if (DEBUG_TRACE) {
      payload.debug = entries;
    }

    res.json(payload);
  });

  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

startServer();
