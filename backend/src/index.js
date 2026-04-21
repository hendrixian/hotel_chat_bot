require("./env");

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
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const {
  initDb,
  seedIfEmpty,
  logMessage,
  getRecentMessages,
  getAdminByUsername,
  upsertAdminUser,
  createAdminSession,
  getAdminSession,
  deleteAdminSession,
  deleteExpiredAdminSessions,
  listRoomInventory,
  upsertRoomInventory,
  getRoomInventoryById,
  updateRoomInventory,
  deleteRoomInventory,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  listReservations,
  createReservation,
  updateReservation,
  deleteReservation,
  listKbEntries,
  createKbEntry,
  updateKbEntry,
  deleteKbEntry
} = require("./db");
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
const BURMESE_TRANSLATION_PARTIAL_PREFIX =
  "\u1018\u102c\u101e\u102c\u1015\u103c\u1014\u103a\u1001\u103c\u1004\u103a\u1038 \u1019\u1015\u103c\u100a\u1037\u103a\u1005\u102f\u1036\u101e\u1031\u1038\u101e\u1031\u102c\u1000\u103c\u1031\u102c\u1004\u1037\u103a English \u1021\u1014\u1031\u1016\u103c\u1004\u1037\u103a \u1016\u1031\u102c\u103a\u1015\u103c\u1015\u102b\u1019\u100a\u103a\u104b";
const MBART_SRC_MY = process.env.MBART_SRC_MY || process.env.NLLB_SRC_MY || "mya_Mymr";
const MBART_TGT_EN = process.env.MBART_TGT_EN || process.env.NLLB_TGT_EN || "eng_Latn";
const BURMESE_CHAR_REGEX = /[\u1000-\u109F]/;
const LATIN_CHAR_REGEX = /[A-Za-z]/;
const LLM_TRANSLATE_FALLBACK = !/^(0|false|no)$/i.test(process.env.LLM_TRANSLATE_FALLBACK || "");
const historyTranslateMaxCharsEnv = Number(process.env.HISTORY_TRANSLATE_MAX_CHARS);
const HISTORY_TRANSLATE_MAX_CHARS =
  Number.isFinite(historyTranslateMaxCharsEnv) && historyTranslateMaxCharsEnv > 0
    ? historyTranslateMaxCharsEnv
    : 420;
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "admin").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "admin123");
const adminSessionHoursEnv = Number(process.env.ADMIN_SESSION_HOURS);
const ADMIN_SESSION_HOURS =
  Number.isFinite(adminSessionHoursEnv) && adminSessionHoursEnv > 0 ? adminSessionHoursEnv : 12;
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

function normalizeLang(code) {
  if (!code) return "";
  return String(code).trim().toLowerCase().replace(/-/g, "_");
}

function isBurmeseLang(code) {
  const c = normalizeLang(code);
  return c.startsWith("mya") || c === "my" || c === "my_mm";
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

function stripMarkdownForTranslation(text) {
  if (!text) return "";
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBurmeseFallbackFromEnglish(text) {
  const english = cleanModelOutput(text) || String(text || "").trim();
  if (!english) return BURMESE_UNAVAILABLE;

  if (/standard room/i.test(english) || /deluxe room/i.test(english)) {
    return "\u101c\u1000\u103a\u101b\u103e\u102d \u101b\u1014\u102d\u102f\u1004\u103a\u101e\u1031\u102c \u1021\u1001\u1014\u103a\u1038\u1021\u1019\u103b\u102d\u102f\u1038\u1021\u1005\u102c\u1038\u1019\u103b\u102c\u1038\u1019\u103e\u102c Standard Room \u1014\u103e\u1004\u1037\u103a Deluxe Room \u1016\u103c\u1005\u103a\u1015\u102b\u101e\u100a\u103a\u104b \u1021\u101e\u1031\u1038\u1005\u102d\u1010\u103a \u101e\u102d\u101c\u102d\u102f\u1015\u102b\u1000 \u1015\u103c\u1031\u102c\u1015\u1031\u1038\u1015\u102b\u104b";
  }

  return `${BURMESE_TRANSLATION_PARTIAL_PREFIX}\n\nEnglish: ${english}`;
}

function tokenizeForRepetition(text) {
  return String(text || "")
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/^[^a-z0-9\u1000-\u109f]+|[^a-z0-9\u1000-\u109f]+$/gi, ""))
    .filter(Boolean);
}

function hasRepeatedNgram(tokens, minSize = 2, maxSize = 4, minRepeats = 3) {
  if (!Array.isArray(tokens) || tokens.length < minSize * minRepeats) {
    return false;
  }

  for (let size = minSize; size <= Math.min(maxSize, tokens.length); size += 1) {
    const counts = new Map();
    for (let i = 0; i <= tokens.length - size; i += 1) {
      const gram = tokens.slice(i, i + size).join(" ");
      const next = (counts.get(gram) || 0) + 1;
      counts.set(gram, next);
      if (next >= minRepeats) {
        return true;
      }
    }
  }

  return false;
}

function looksHighlyRepetitive(text) {
  const tokens = tokenizeForRepetition(text);
  if (tokens.length < 12) {
    return false;
  }

  const uniqueRatio = new Set(tokens).size / tokens.length;
  if (tokens.length >= 20 && uniqueRatio < 0.55) {
    return true;
  }

  return hasRepeatedNgram(tokens);
}

function looksBrokenTranslation(sourceText, translatedText, targetLang) {
  const source = String(sourceText || "").trim();
  const translated = cleanTranslationOutput(translatedText);
  const sourceHasBurmese = hasBurmese(source);
  const sourceHasLatin = hasLatin(source);
  const sourceLooksMultiWord = /\s/.test(source);

  if (!translated) {
    return true;
  }

  if (translated === source) {
    if (sourceHasBurmese) return true;
    if (isBurmeseLang(targetLang) && sourceHasLatin && sourceLooksMultiWord) return true;
  }

  if (isBurmeseLang(targetLang)) {
    if (sourceHasLatin && sourceLooksMultiWord && translated.length >= 8 && !hasBurmese(translated)) {
      return true;
    }
  } else {
    if (sourceHasBurmese && translated.length >= 8 && !hasLatin(translated)) {
      return true;
    }
  }

  if (looksHighlyRepetitive(translated)) {
    return true;
  }

  if (source && translated.length > Math.max(160, source.length * 8) && looksHighlyRepetitive(translated)) {
    return true;
  }

  return false;
}

const MYANMAR_DIGIT_MAP = {
  0: "\u1040",
  1: "\u1041",
  2: "\u1042",
  3: "\u1043",
  4: "\u1044",
  5: "\u1045",
  6: "\u1046",
  7: "\u1047",
  8: "\u1048",
  9: "\u1049"
};

function toMyanmarDigits(value) {
  return String(value || "").replace(/\d/g, (digit) => MYANMAR_DIGIT_MAP[digit] || digit);
}

function replaceAddressTermsToBurmese(text) {
  let out = String(text || "");
  out = out.replace(/\bNo\.\s*(\d+)\b/gi, (_, num) => `အမှတ် ${toMyanmarDigits(num)}`);
  out = out.replace(/\bPyay Road\b/gi, "ပြည်လမ်း");
  out = out.replace(/\bSanchaung Township\b/gi, "စမ်းချောင်းမြို့နယ်");
  out = out.replace(/\bYangon\b/gi, "ရန်ကုန်");
  out = out.replace(/\bMyanmar\b/gi, "မြန်မာနိုင်ငံ");
  out = out.replace(/\bShwedagon Pagoda\b/gi, "ရွှေတိဂုံစေတီတော်");
  out = out.replace(/\bJunction Square\b/gi, "Junction Square");
  out = out.replace(/\bRoad\b/gi, "လမ်း");
  out = out.replace(/\bTownship\b/gi, "မြို့နယ်");
  return out;
}

function fallbackAddressTranslationToBurmese(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const locatedMatch = raw.match(/^\s*The hotel is located at\s+(.+?)\.\s*$/i);
  if (locatedMatch) {
    const addr = replaceAddressTermsToBurmese(locatedMatch[1]);
    return `ဟိုတယ်သည် ${addr} တွင် တည်ရှိပါသည်။`;
  }

  const locatedNearMatch = raw.match(/^\s*The hotel is located at\s+(.+?)\.\s*It is near\s+(.+?)\.\s*$/i);
  if (locatedNearMatch) {
    const addr = replaceAddressTermsToBurmese(locatedNearMatch[1]);
    const nearby = replaceAddressTermsToBurmese(locatedNearMatch[2]);
    return `ဟိုတယ်သည် ${addr} တွင် တည်ရှိပါသည်။ ${nearby} အနီးတွင် ရှိပါသည်။`;
  }

  const nearMatch = raw.match(/^\s*It is near\s+(.+?)\.\s*$/i);
  if (nearMatch) {
    const nearby = replaceAddressTermsToBurmese(nearMatch[1]);
    return `${nearby} အနီးတွင် ရှိပါသည်။`;
  }

  const replaced = replaceAddressTermsToBurmese(raw);
  return hasBurmese(replaced) ? replaced : "";
}

function cleanRewriteOutput(text) {
  let cleaned = cleanModelOutput(text);
  if (!cleaned) return cleaned;
  if (looksLikeReasoning(cleaned)) return "";
  if (hasLatin(cleaned)) return "";
  return cleaned.trim();
}

function enforceBurmesePoliteAddress(text) {
  if (!text) return text;
  let out = String(text);
  const politeYou = "\u101c\u1030\u1000\u103c\u102e\u1038\u1019\u1004\u103a\u1038";
  const youBasic = "\u101e\u1004\u103a";
  const youDot1 = "\u101e\u1004\u103a\u1037";
  const youDot2 = "\u101e\u1004\u1037\u103a";
  out = out.replace(new RegExp(youDot1, "g"), politeYou);
  out = out.replace(new RegExp(youDot2, "g"), politeYou);
  out = out.replace(new RegExp(youBasic + "(?!\\u1039)", "g"), politeYou);
  return out;
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
    let translated = await callColabTranslate({ text, sourceLang, targetLang });
    translated = cleanTranslationOutput(translated) || "";
    if (!translated) {
      throw new Error("Empty translation response");
    }
    if (looksBrokenTranslation(text, translated, targetLang)) {
      throw new Error("Degenerate translation response");
    }
    if (isBurmeseLang(targetLang)) {
      translated = enforceBurmesePoliteAddress(translated);
    }
    return translated;
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    if (reason === "Degenerate translation response") {
      debug("Colab translate returned low-quality output; fallback engaged");
    } else {
      debug("Colab translate failed", reason);
    }
    return text;
  }
}

async function translateWithLLM(text, sourceLang, targetLang) {
  const toBurmese = isBurmeseLang(targetLang);
  const prompt = [
    "You are a translation engine.",
    `Translate the text from ${languageLabel(sourceLang)} to ${languageLabel(targetLang)}.`,
    toBurmese
      ? "Return only Burmese translation text. Do not explain or discuss the translation."
      : "Return only the translation without quotes or extra commentary.",
    toBurmese
      ? "Keep location names natural in Burmese (for example: Pyay Road -> ပြည်လမ်း, Sanchaung Township -> စမ်းချောင်းမြို့နယ်)."
      : "",
    "",
    text
  ].filter(Boolean).join("\n");
  const raw = await generateWithFallback(prompt, { maxTokens: 256, temperature: 0 });
  const cleaned = cleanTranslationOutput(raw) || "";
  if (toBurmese) {
    return enforceBurmesePoliteAddress(cleaned);
  }
  return cleaned;
}

async function safeTranslateWithFallback(text, sourceLang, targetLang) {
  const translated = await safeTranslate(text, sourceLang, targetLang);
  if (!translated || translated === text) {
    if (!LLM_TRANSLATE_FALLBACK) return translated || text;
    try {
      const fallback = await translateWithLLM(text, sourceLang, targetLang);
      if (fallback && !looksBrokenTranslation(text, fallback, targetLang)) {
        return fallback;
      }
      if (isBurmeseLang(targetLang)) {
        const deterministic = fallbackAddressTranslationToBurmese(text);
        if (deterministic && !looksBrokenTranslation(text, deterministic, targetLang)) {
          debug("Using deterministic address translation fallback");
          return deterministic;
        }
      }
      return translated || text;
    } catch (err) {
      debug("LLM translate fallback failed", err && err.message ? err.message : err);
      if (isBurmeseLang(targetLang)) {
        const deterministic = fallbackAddressTranslationToBurmese(text);
        if (deterministic && !looksBrokenTranslation(text, deterministic, targetLang)) {
          debug("Using deterministic address translation fallback after LLM failure");
          return deterministic;
        }
      }
      return translated || text;
    }
  }
  return translated;
}

async function translateHistoryToEnglish(history) {
  if (!history || history.length === 0) return history;
  const translated = [];
  for (const msg of history) {
    const contentRaw = String(msg && msg.content ? msg.content : "");
    if (hasBurmese(contentRaw) && contentRaw.length <= HISTORY_TRANSLATE_MAX_CHARS) {
      const content = await safeTranslateWithFallback(contentRaw, MBART_SRC_MY, MBART_TGT_EN);
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
    const cleaned = cleanModelOutput(refined);
    if (!cleaned || looksLikeReasoning(cleaned)) {
      return draft;
    }
    return cleaned;
  } catch (err) {
    debug("Refine failed", err && err.message ? err.message : err);
    return draft;
  }
}

function hashAdminPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 64, "sha512");
  return {
    hashHex: hash.toString("hex"),
    saltHex: salt.toString("hex")
  };
}

function verifyAdminPassword(password, storedHashHex, storedSaltHex) {
  const computed = hashAdminPassword(password, storedSaltHex).hashHex;
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(String(storedHashHex || ""), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function addHoursIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function sanitizeAdminUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username
  };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isUpcomingEventsQuery(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  return /(upcoming|next|future)\s+events?/i.test(text)
    || /\bevents?\b/i.test(text)
    || /ပွဲ|အခမ်းအနား|လာမယ့်ပွဲ|အဖြစ်အပျက်/.test(text);
}

function formatUpcomingEventsReply(language, rows) {
  const events = Array.isArray(rows) ? rows.slice(0, 6) : [];

  if (language === "my") {
    if (events.length === 0) {
      return "လတ်တလော ကြိုတင်စီစဉ်ထားသော ပွဲအစီအစဉ်မရှိသေးပါ။ အသေးစိတ်အတွက် Front Desk ကို ဆက်သွယ်မေးမြန်းနိုင်ပါသည်။";
    }

    const lines = ["လာမည့် ပွဲအစီအစဉ်များမှာ:"];
    for (let i = 0; i < events.length; i += 1) {
      const row = events[i];
      const title = String(row.title_my || row.title_en || "Event").trim();
      const desc = String(row.description_my || row.description_en || "").trim();
      const venue = String(row.venue || "").trim();
      const dateRange = row.start_date === row.end_date
        ? row.start_date
        : `${row.start_date} မှ ${row.end_date}`;
      lines.push(`${i + 1}. ${title}${venue ? ` (${venue})` : ""} (${dateRange})${desc ? ` - ${desc}` : ""}`);
    }
    return lines.join("\n");
  }

  if (events.length === 0) {
    return "There are no upcoming events scheduled at the moment. Please check with the front desk for updates.";
  }

  const lines = ["Here are the upcoming events:"];
  for (let i = 0; i < events.length; i += 1) {
    const row = events[i];
    const title = String(row.title_en || row.title_my || "Event").trim();
    const desc = String(row.description_en || row.description_my || "").trim();
    const venue = String(row.venue || "").trim();
    const dateRange = row.start_date === row.end_date
      ? row.start_date
      : `${row.start_date} to ${row.end_date}`;
    lines.push(`${i + 1}. ${title}${venue ? ` (${venue})` : ""} (${dateRange})${desc ? ` - ${desc}` : ""}`);
  }
  return lines.join("\n");
}

function extractAdminToken(req) {
  const auth = String(req.headers.authorization || "");
  if (/^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  return String(req.headers["x-admin-token"] || "").trim();
}

function parseTags(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDateInput(value) {
  return String(value || "").trim().slice(0, 10);
}

function isValidDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function rowWithTags(row) {
  if (!row) return row;
  return {
    ...row,
    tags: parseTags(row.tags)
  };
}

async function resolveBilingualPair({ textEn, textMy, sourceLang }) {
  const enRaw = String(textEn || "").trim();
  const myRaw = String(textMy || "").trim();
  const source = String(sourceLang || "").toLowerCase() === "my" ? "my" : "en";

  if (enRaw && myRaw) {
    return { en: enRaw, my: myRaw };
  }

  if (source === "my") {
    const my = myRaw || enRaw;
    const en = enRaw || (await safeTranslateWithFallback(my, MBART_SRC_MY, MBART_TGT_EN));
    return { en: String(en || "").trim(), my: String(my || "").trim() };
  }

  const en = enRaw || myRaw;
  const my = myRaw || (await safeTranslateWithFallback(en, MBART_TGT_EN, MBART_SRC_MY));
  return { en: String(en || "").trim(), my: String(my || "").trim() };
}

function prepareBilingualUpdateInputs({ existingEn, existingMy, incomingEn, incomingMy, sourceLang }) {
  const src = String(sourceLang || "").toLowerCase() === "my" ? "my" : "en";
  const hasIncomingEn = incomingEn !== undefined && incomingEn !== null;
  const hasIncomingMy = incomingMy !== undefined && incomingMy !== null;

  if (hasIncomingEn && hasIncomingMy) {
    return { textEn: incomingEn, textMy: incomingMy, sourceLang: src };
  }

  if (src === "en" && hasIncomingEn && !hasIncomingMy) {
    return { textEn: incomingEn, textMy: "", sourceLang: "en" };
  }

  if (src === "my" && hasIncomingMy && !hasIncomingEn) {
    return { textEn: "", textMy: incomingMy, sourceLang: "my" };
  }

  return {
    textEn: hasIncomingEn ? incomingEn : existingEn,
    textMy: hasIncomingMy ? incomingMy : existingMy,
    sourceLang: src
  };
}

async function startServer() {
  await initDb();
  seedIfEmpty();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  const existingAdmin = getAdminByUsername(ADMIN_USERNAME);
  if (!existingAdmin) {
    const { hashHex, saltHex } = hashAdminPassword(ADMIN_PASSWORD);
    upsertAdminUser({ username: ADMIN_USERNAME, passwordHash: hashHex, passwordSalt: saltHex });
    if (ADMIN_PASSWORD === "admin123") {
      console.warn("[admin] Using default admin password. Set ADMIN_PASSWORD in .env for production.");
    }
  }

  function requireAdmin(req, res, next) {
    deleteExpiredAdminSessions();
    const token = extractAdminToken(req);
    if (!token) {
      return res.status(401).json({ error: "Admin authentication required" });
    }

    const session = getAdminSession(token);
    if (!session) {
      return res.status(401).json({ error: "Invalid or expired admin session" });
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      deleteAdminSession(token);
      return res.status(401).json({ error: "Admin session expired" });
    }

    req.admin = {
      token,
      id: session.admin_user_id,
      username: session.username
    };
    next();
  }

  function adminAsync(handler) {
    return (req, res, next) => {
      Promise.resolve(handler(req, res, next)).catch((err) => {
        const message = err && err.message ? err.message : "Admin request failed";
        debug("Admin route failed", message);
        res.status(500).json({ error: message });
      });
    };
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/admin/login", (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    deleteExpiredAdminSessions();

    const admin = getAdminByUsername(username);
    if (!admin || !verifyAdminPassword(password, admin.password_hash, admin.password_salt)) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = addHoursIso(ADMIN_SESSION_HOURS);
    createAdminSession({ token, adminUserId: admin.id, expiresAt });

    res.json({
      token,
      expiresAt,
      user: sanitizeAdminUser(admin)
    });
  });

  app.post("/api/admin/logout", requireAdmin, (req, res) => {
    deleteAdminSession(req.admin.token);
    res.json({ ok: true });
  });

  app.get("/api/admin/me", requireAdmin, (req, res) => {
    res.json({ user: { id: req.admin.id, username: req.admin.username } });
  });

  app.get("/api/admin/room-inventory", requireAdmin, (req, res) => {
    const rows = listRoomInventory({
      dateFrom: req.query?.dateFrom,
      dateTo: req.query?.dateTo,
      roomType: req.query?.roomType
    });
    res.json({ rows });
  });

  app.post("/api/admin/room-inventory", requireAdmin, (req, res) => {
    const roomType = String(req.body?.roomType || "").trim();
    const date = normalizeDateInput(req.body?.date);
    const totalRooms = Number(req.body?.totalRooms);
    const availableRooms = Number(req.body?.availableRooms);
    const priceUsd = req.body?.priceUsd;
    const notes = String(req.body?.notes || "");

    if (!roomType || !isValidDateInput(date)) {
      return res.status(400).json({ error: "roomType and valid date (YYYY-MM-DD) are required" });
    }
    if (!Number.isFinite(totalRooms) || !Number.isFinite(availableRooms)) {
      return res.status(400).json({ error: "totalRooms and availableRooms must be numbers" });
    }

    const row = upsertRoomInventory({
      roomType,
      date,
      totalRooms,
      availableRooms,
      priceUsd,
      notes
    });
    res.json({ row });
  });

  app.put("/api/admin/room-inventory/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid inventory id" });
    }
    const existing = getRoomInventoryById(id);
    if (!existing) {
      return res.status(404).json({ error: "Inventory row not found" });
    }

    const roomType = String(req.body?.roomType || existing.room_type || "").trim();
    const date = normalizeDateInput(req.body?.date || existing.date);
    const totalRooms = Number(req.body?.totalRooms ?? existing.total_rooms);
    const availableRooms = Number(req.body?.availableRooms ?? existing.available_rooms);
    const priceUsd = req.body?.priceUsd ?? existing.price_usd;
    const notes = req.body?.notes ?? existing.notes;

    if (!roomType || !isValidDateInput(date)) {
      return res.status(400).json({ error: "roomType and valid date (YYYY-MM-DD) are required" });
    }
    if (!Number.isFinite(totalRooms) || !Number.isFinite(availableRooms)) {
      return res.status(400).json({ error: "totalRooms and availableRooms must be numbers" });
    }

    const row = updateRoomInventory(id, {
      roomType,
      date,
      totalRooms,
      availableRooms,
      priceUsd,
      notes
    });
    res.json({ row });
  });

  app.delete("/api/admin/room-inventory/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid inventory id" });
    }
    deleteRoomInventory(id);
    res.json({ ok: true });
  });

  app.get("/api/admin/events", requireAdmin, (req, res) => {
    const rows = listEvents({
      dateFrom: req.query?.dateFrom,
      dateTo: req.query?.dateTo
    });
    res.json({ rows });
  });

  app.post("/api/admin/events", requireAdmin, adminAsync(async (req, res) => {
    const startDate = normalizeDateInput(req.body?.startDate);
    const endDate = normalizeDateInput(req.body?.endDate);
    const venueRaw = String(req.body?.venue || "").trim();
    const venue = venueRaw === "[object Object]" ? "" : venueRaw;
    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      return res.status(400).json({ error: "startDate and endDate are required in YYYY-MM-DD format" });
    }
    if (!venue) {
      return res.status(400).json({ error: "venue is required for events" });
    }

    const titlePair = await resolveBilingualPair({
      textEn: req.body?.titleEn,
      textMy: req.body?.titleMy,
      sourceLang: req.body?.sourceLang || "en"
    });
    const descPair = await resolveBilingualPair({
      textEn: req.body?.descriptionEn,
      textMy: req.body?.descriptionMy,
      sourceLang: req.body?.sourceLang || "en"
    });

    if (!titlePair.en || !titlePair.my) {
      return res.status(400).json({ error: "Event title is required and must be translatable in both languages" });
    }

    const row = createEvent({
      titleEn: titlePair.en,
      titleMy: titlePair.my,
      descriptionEn: descPair.en,
      descriptionMy: descPair.my,
      venue,
      startDate,
      endDate
    });
    res.json({ row });
  }));

  app.put("/api/admin/events/:id", requireAdmin, adminAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid event id" });
    }

    const existing = listEvents().find((row) => row.id === id);
    if (!existing) {
      return res.status(404).json({ error: "Event not found" });
    }

    const startDate = normalizeDateInput(req.body?.startDate || existing.start_date);
    const endDate = normalizeDateInput(req.body?.endDate || existing.end_date);
    const venueRaw = String(req.body?.venue ?? existing.venue ?? "").trim();
    const venue = venueRaw === "[object Object]" ? "" : venueRaw;
    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      return res.status(400).json({ error: "startDate and endDate are required in YYYY-MM-DD format" });
    }
    if (!venue) {
      return res.status(400).json({ error: "venue is required for events" });
    }

    const titlePair = await resolveBilingualPair(
      prepareBilingualUpdateInputs({
        existingEn: existing.title_en,
        existingMy: existing.title_my,
        incomingEn: req.body?.titleEn,
        incomingMy: req.body?.titleMy,
        sourceLang: req.body?.sourceLang || "en"
      })
    );
    const descPair = await resolveBilingualPair(
      prepareBilingualUpdateInputs({
        existingEn: existing.description_en || "",
        existingMy: existing.description_my || "",
        incomingEn: req.body?.descriptionEn,
        incomingMy: req.body?.descriptionMy,
        sourceLang: req.body?.sourceLang || "en"
      })
    );

    const row = updateEvent(id, {
      titleEn: titlePair.en,
      titleMy: titlePair.my,
      descriptionEn: descPair.en,
      descriptionMy: descPair.my,
      venue,
      startDate,
      endDate
    });
    res.json({ row });
  }));

  app.delete("/api/admin/events/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid event id" });
    }
    deleteEvent(id);
    res.json({ ok: true });
  });

  app.get("/api/admin/reservations", requireAdmin, (req, res) => {
    const rows = listReservations({
      dateFrom: req.query?.dateFrom,
      dateTo: req.query?.dateTo,
      status: req.query?.status
    });
    res.json({ rows });
  });

  app.post("/api/admin/reservations", requireAdmin, (req, res) => {
    const guestName = String(req.body?.guestName || "").trim();
    const roomType = String(req.body?.roomType || "").trim();
    const checkInDate = normalizeDateInput(req.body?.checkInDate);
    const checkOutDate = normalizeDateInput(req.body?.checkOutDate);
    const roomCount = Number(req.body?.roomCount || 1);
    const status = String(req.body?.status || "confirmed").trim().toLowerCase();

    if (!guestName || !roomType || !isValidDateInput(checkInDate) || !isValidDateInput(checkOutDate)) {
      return res.status(400).json({ error: "guestName, roomType, checkInDate and checkOutDate are required" });
    }
    if (!Number.isFinite(roomCount) || roomCount <= 0) {
      return res.status(400).json({ error: "roomCount must be a positive number" });
    }

    const row = createReservation({
      guestName,
      contact: req.body?.contact,
      roomType,
      checkInDate,
      checkOutDate,
      roomCount,
      status,
      notes: req.body?.notes
    });
    res.json({ row });
  });

  app.put("/api/admin/reservations/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid reservation id" });
    }
    const existing = listReservations().find((row) => row.id === id);
    if (!existing) {
      return res.status(404).json({ error: "Reservation not found" });
    }

    const guestName = String(req.body?.guestName ?? existing.guest_name).trim();
    const roomType = String(req.body?.roomType ?? existing.room_type).trim();
    const checkInDate = normalizeDateInput(req.body?.checkInDate ?? existing.check_in_date);
    const checkOutDate = normalizeDateInput(req.body?.checkOutDate ?? existing.check_out_date);
    const roomCount = Number(req.body?.roomCount ?? existing.room_count);
    const status = String(req.body?.status ?? existing.status).trim().toLowerCase();

    if (!guestName || !roomType || !isValidDateInput(checkInDate) || !isValidDateInput(checkOutDate)) {
      return res.status(400).json({ error: "guestName, roomType, checkInDate and checkOutDate are required" });
    }
    if (!Number.isFinite(roomCount) || roomCount <= 0) {
      return res.status(400).json({ error: "roomCount must be a positive number" });
    }

    const row = updateReservation(id, {
      guestName,
      contact: req.body?.contact ?? existing.contact,
      roomType,
      checkInDate,
      checkOutDate,
      roomCount,
      status,
      notes: req.body?.notes ?? existing.notes
    });
    res.json({ row });
  });

  app.delete("/api/admin/reservations/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid reservation id" });
    }
    deleteReservation(id);
    res.json({ ok: true });
  });

  app.get("/api/admin/kb-entries", requireAdmin, (req, res) => {
    const rows = listKbEntries().map(rowWithTags);
    res.json({ rows });
  });

  app.post("/api/admin/kb-entries", requireAdmin, adminAsync(async (req, res) => {
    const kbKey = String(req.body?.kbKey || "").trim();
    const category = String(req.body?.category || "general").trim();
    if (!kbKey) {
      return res.status(400).json({ error: "kbKey is required" });
    }

    const titlePair = await resolveBilingualPair({
      textEn: req.body?.titleEn,
      textMy: req.body?.titleMy,
      sourceLang: req.body?.sourceLang || "en"
    });
    const contentPair = await resolveBilingualPair({
      textEn: req.body?.contentEn,
      textMy: req.body?.contentMy,
      sourceLang: req.body?.sourceLang || "en"
    });

    if (!titlePair.en || !titlePair.my || !contentPair.en || !contentPair.my) {
      return res.status(400).json({ error: "title and content are required and must be available in both languages" });
    }

    const row = createKbEntry({
      kbKey,
      category,
      titleEn: titlePair.en,
      titleMy: titlePair.my,
      contentEn: contentPair.en,
      contentMy: contentPair.my,
      tags: parseTags(req.body?.tags),
      updatedBy: req.admin.username
    });
    res.json({ row: rowWithTags(row) });
  }));

  app.put("/api/admin/kb-entries/:id", requireAdmin, adminAsync(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid KB entry id" });
    }
    const existing = listKbEntries().find((row) => row.id === id);
    if (!existing) {
      return res.status(404).json({ error: "KB entry not found" });
    }

    const titlePair = await resolveBilingualPair(
      prepareBilingualUpdateInputs({
        existingEn: existing.title_en,
        existingMy: existing.title_my,
        incomingEn: req.body?.titleEn,
        incomingMy: req.body?.titleMy,
        sourceLang: req.body?.sourceLang || "en"
      })
    );
    const contentPair = await resolveBilingualPair(
      prepareBilingualUpdateInputs({
        existingEn: existing.content_en,
        existingMy: existing.content_my,
        incomingEn: req.body?.contentEn,
        incomingMy: req.body?.contentMy,
        sourceLang: req.body?.sourceLang || "en"
      })
    );

    const row = updateKbEntry(id, {
      kbKey: req.body?.kbKey ?? existing.kb_key,
      category: req.body?.category ?? existing.category,
      titleEn: titlePair.en,
      titleMy: titlePair.my,
      contentEn: contentPair.en,
      contentMy: contentPair.my,
      tags: req.body?.tags ?? parseTags(existing.tags),
      updatedBy: req.admin.username
    });
    res.json({ row: rowWithTags(row) });
  }));

  app.delete("/api/admin/kb-entries/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid KB entry id" });
    }
    deleteKbEntry(id);
    res.json({ ok: true });
  });

  app.get("/api/admin/kb", requireAdmin, (req, res) => {
    const lang = req.query?.lang === "my" ? "my" : req.query?.lang === "en" ? "en" : null;
    const kb = lang ? getKbLocalized(lang) : getKb();
    if (!kb) {
      return res.status(500).json({ error: "Knowledge base not available" });
    }
    res.json(kb);
  });

  app.get("/api/kb", (req, res) => {
    res.status(403).json({ error: "Use /api/admin/kb with admin authentication" });
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
      translated.push(await safeTranslate(String(text || ""), MBART_TGT_EN, MBART_SRC_MY));
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
    const directUpcomingEvents = isUpcomingEventsQuery(message);
    trace("direct.upcomingEvents", directUpcomingEvents);

    if (directUpcomingEvents) {
      const today = todayIsoDate();
      const upcomingEvents = listEvents({ dateFrom: today });
      const normalizedUpcoming = upcomingEvents.map((row) => ({
        id: row.id,
        title_en: row.title_en,
        title_my: row.title_my,
        description_en: row.description_en,
        description_my: row.description_my,
        start_date: row.start_date,
        end_date: row.end_date
      }));
      trace("direct.upcomingEvents.count", normalizedUpcoming.length);

      replyText = formatUpcomingEventsReply(language, normalizedUpcoming);
      contextDocs = normalizedUpcoming.map((row) => ({
        source: "event-direct",
        text: `Event ${row.title_en || row.title_my} from ${row.start_date} to ${row.end_date}. ${row.description_en || row.description_my || ""}`.trim()
      }));

      if (language === "my") {
        replyText = enforceBurmesePoliteAddress(replyText);
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

      return res.json(payload);
    }

    try {
      if (language === "my") {
        const translatedMessage = await safeTranslateWithFallback(message, MBART_SRC_MY, MBART_TGT_EN);
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

          const translationInput = stripMarkdownForTranslation(refinedEnglish);
          trace("translate.en->my.input", translationInput);
          const translatedBack = await safeTranslateWithFallback(translationInput, MBART_TGT_EN, MBART_SRC_MY);
          trace("translate.en->my", translatedBack);
          const translationBackOk = hasBurmese(translatedBack);
          trace("translate.en->my.ok", translationBackOk);

          if (!translationBackOk) {
            replyText = buildBurmeseFallbackFromEnglish(translationInput);
            trace("rewrite.my", "(fallback) partial translation");
          } else {
            try {
              const rewriteInput = translatedBack;
              const rewritten = await callBurmeseAIRewrite({ text: rewriteInput });
              const cleanedRewrite = cleanRewriteOutput(rewritten);
              if (cleanedRewrite && hasBurmese(cleanedRewrite)) {
                replyText = cleanedRewrite;
                trace("rewrite.my", replyText);
              } else {
                replyText = translatedBack;
                trace("rewrite.my", "(fallback) translation used");
              }
            } catch (err) {
              debug("Burmese rewrite failed", err && err.message ? err.message : err);
              replyText = translatedBack;
              trace("rewrite.my", "(fallback) translation used");
            }
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

    if (language === "my") {
      replyText = enforceBurmesePoliteAddress(replyText);
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







