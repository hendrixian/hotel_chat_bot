function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function countSentences(text) {
  const matches = text.match(/[.!?]/g);
  return matches ? matches.length : 1;
}

function parseKeywordList(raw) {
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function classifyIntent(message) {
  const normalized = normalizeText(message);
  const maxChars = Number(process.env.ROUTER_SIMPLE_MAX_CHARS || 120);
  const maxSentences = Number(process.env.ROUTER_SIMPLE_MAX_SENTENCES || 2);
  const simpleKeywords = parseKeywordList(process.env.ROUTER_SIMPLE_KEYWORDS);

  const looksLikeBooking =
    /(book|booking|reserve|reservation|availability|room for)/.test(normalized);
  if (looksLikeBooking) {
    return "booking";
  }

  const shortEnough = normalized.length <= maxChars;
  const sentenceCount = countSentences(normalized);
  const keywordHit = simpleKeywords.some((kw) => normalized.includes(kw));

  if (shortEnough && sentenceCount <= maxSentences && keywordHit) {
    return "faq";
  }

  return "complex";
}

module.exports = {
  classifyIntent
};
