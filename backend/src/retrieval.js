const fetch = require("./fetch");
const { searchFactsLike, listRooms } = require("./db");

async function retrieveFromAICore(query, topK = 5) {
  const url = process.env.AI_CORE_URL;
  if (!url) return null;

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK })
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

function fallbackRetrieve(query, topK = 5) {
  const facts = searchFactsLike(query, topK).map((row) => ({
    text: `${row.title}: ${row.content}`,
    source: row.category,
    score: 0
  }));

  const rooms = listRooms().map((room) => ({
    text: `${room.name} (capacity ${room.capacity}, ${room.features})`,
    source: "room",
    score: 0
  }));

  return [...facts, ...rooms].slice(0, topK);
}

async function retrieveContext(query, topK = 5) {
  const aiCoreResults = await retrieveFromAICore(query, topK);
  if (aiCoreResults && aiCoreResults.length) {
    return aiCoreResults;
  }
  return fallbackRetrieve(query, topK);
}

module.exports = {
  retrieveContext
};
