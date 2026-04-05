require("dotenv").config();

const DEBUG_LLM = /^(1|true|yes)$/i.test(process.env.DEBUG_LLM || "");

function debug(...args) {
  if (DEBUG_LLM) {
    console.log("[chat]", ...args);
  }
}

const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const { initDb, seedIfEmpty, logMessage, getRecentMessages } = require("./db");
const { classifyIntent } = require("./router");
const { retrieveContext } = require("./retrieval");
const {
  callColabLLM,
  callColabTranslate,
  callColabIntent,
  callBurmeseAIRewrite,
  callOllama
} = require("./llm");
const { buildPrompt } = require("./prompt");

const BURMESE_UNAVAILABLE = "\u1005\u1014\u1005\u103a\u1000\u102d\u102f \u101a\u102c\u101a\u102e\u1021\u101e\u102f\u1036\u1038\u1019\u1015\u103c\u102f\u1014\u102d\u102f\u1004\u103a\u1015\u102b\u104b \u1001\u100f\u1014\u1031\u102c\u1000\u103a\u1019\u103e \u1015\u103c\u1014\u103a\u101c\u100a\u103a\u1000\u103c\u102d\u102f\u1038\u1005\u102c\u1038\u1015\u102b\u104b";
const NLLB_SRC_MY = process.env.NLLB_SRC_MY || "mya_Mymr";
const NLLB_TGT_EN = process.env.NLLB_TGT_EN || "eng_Latn";

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

async function safeTranslate(text, sourceLang, targetLang) {
  if (!text) return text;
  try {
    return await callColabTranslate({ text, sourceLang, targetLang });
  } catch (err) {
    return text;
  }
}

async function translateHistory(history, sourceLang, targetLang) {
  if (!history || history.length === 0) return history;
  const translated = [];
  for (const msg of history) {
    const content = await safeTranslate(msg.content, sourceLang, targetLang);
    translated.push({ ...msg, content });
  }
  return translated;
}

async function resolveIntent(message, language) {
  if (language !== "my") {
    return classifyIntent(message);
  }

  try {
    const rawIntent = await callColabIntent({ text: message });
    const intentEn = await safeTranslate(rawIntent, NLLB_SRC_MY, NLLB_TGT_EN);
    return normalizeIntentLabel(intentEn);
  } catch (err) {
    return "complex";
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

  app.post("/api/chat", async (req, res) => {
    const message = (req.body.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const sessionId = req.body.sessionId || uuidv4();
    const language = req.body.language === "my" ? "my" : "en";

    const history = getRecentMessages(sessionId, 6);
    const intent = await resolveIntent(message, language);

    let workingMessage = message;
    let workingHistory = history;

    if (language === "my") {
      workingMessage = await safeTranslate(message, NLLB_SRC_MY, NLLB_TGT_EN);
      workingHistory = await translateHistory(history, NLLB_SRC_MY, NLLB_TGT_EN);
    }

    const contextDocs = await retrieveContext(workingMessage, 5);
    const prompt = buildPrompt({
      message: workingMessage,
      contextDocs,
      history: workingHistory,
      language: "en"
    });

    let replyText = "";
    try {
      try {
        replyText = await callColabLLM({ prompt, maxTokens: 512, temperature: 0.2 });
      } catch (err) {
        debug("Colab LLM failed", err && err.message ? err.message : err);
        if (process.env.OLLAMA_URL) {
          try {
            replyText = await callOllama({ prompt, model: process.env.OLLAMA_MODEL || "mistral" });
          } catch (ollamaErr) {
            debug("Ollama failed", ollamaErr && ollamaErr.message ? ollamaErr.message : ollamaErr);
            throw ollamaErr;
          }
        } else {
          throw err;
        }
      }

      if (language === "my") {
        const translated = await safeTranslate(replyText, NLLB_TGT_EN, NLLB_SRC_MY);
        try {
          replyText = await callBurmeseAIRewrite({ text: translated });
        } catch (err) {
          replyText = translated;
        }
      }
    } catch (err) {
      debug("Chat failed", err && err.message ? err.message : err);
      replyText = language === "my"
        ? BURMESE_UNAVAILABLE
        : "Sorry, the system is temporarily unavailable. Please try again in a moment.";
    }

    logMessage(sessionId, "user", message);
    logMessage(sessionId, "assistant", replyText);

    res.json({
      sessionId,
      intent,
      reply: replyText,
      context: contextDocs
    });
  });

  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

startServer();
