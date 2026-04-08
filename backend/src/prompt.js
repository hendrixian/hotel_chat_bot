function systemPrompt(language) {
  if (language === "my") {
    return "You are a helpful hotel assistant. Reply politely in Burmese (Myanmar). Use provided hotel information. Answer directly without analysis or internal reasoning. Return only the final answer. If the answer is not in the context, say you will check with the front desk. Do not include English or translations.";
  }
  return "You are a helpful hotel assistant. Answer politely in English. Use the provided hotel information. Answer directly without analysis or internal reasoning. Return only the final answer. If the answer is not in the context, say you will check with the front desk. Do not include Burmese or translations.";
}

function formatHistory(history) {
  if (!history || history.length === 0) return "";
  return history
    .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n");
}

function buildPrompt({ message, contextDocs, history, language }) {
  const contextText = contextDocs
    .map((doc) => `- ${doc.text}`)
    .join("\n");

  const historyText = formatHistory(history);

  return [
    systemPrompt(language),
    "",
    "Hotel Context:",
    contextText || "- (no context)",
    "",
    historyText ? `Conversation:\n${historyText}` : "",
    historyText ? "" : "",
    `User: ${message}`,
    "Assistant:"
  ].join("\n");
}

function buildRefinePrompt({ message, contextDocs, draft }) {
  const contextText = contextDocs
    .map((doc) => `- ${doc.text}`)
    .join("\n");

  return [
    "You are a hotel assistant.",
    "Refine the draft answer for clarity, tone, and concision.",
    "Keep the response in English.",
    "Use the provided hotel context. Do not add new facts.",
    "Return only the refined answer.",
    "Do not include analysis, reasoning, or meta commentary.",
    "",
    "Hotel Context:",
    contextText || "- (no context)",
    "",
    `User: ${message}`,
    "",
    `Draft: ${draft}`,
    "",
    "Refined answer:"
  ].join("\n");
}

module.exports = {
  buildPrompt,
  buildRefinePrompt
};
