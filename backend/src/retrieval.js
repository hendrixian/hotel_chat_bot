const fetch = require("./fetch");
const { getKbDocs } = require("./kb");

async function retrieveFromAICore(query, topK = 5, language = "en") {
  const url = process.env.AI_CORE_URL;
  if (!url) return null;

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK, language })
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return Array.isArray(data.results) ? data.results : null;
  } catch (err) {
    return null;
  }
}

function scoreDoc(text, tokens) {
  if (!tokens.length) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

function fallbackRetrieve(query, topK = 5, language = "en") {
  const docs = getKbDocs(language).map((doc) => ({
    text: doc.text,
    source: doc.source || "kb",
    score: 0
  }));

  if (!query || docs.length === 0) {
    return docs.slice(0, topK);
  }

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = docs.map((doc, idx) => ({
    ...doc,
    score: scoreDoc(doc.text, tokens),
    idx
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });

  return scored.slice(0, topK).map(({ idx, ...doc }) => doc);
}

async function retrieveContext(query, topK = 5, language = "en") {
  const aiCoreResults = await retrieveFromAICore(query, topK, language);
  if (aiCoreResults && aiCoreResults.length) {
    return aiCoreResults;
  }
  return fallbackRetrieve(query, topK, language);
}

module.exports = {
  retrieveContext
};
