function systemPrompt(language) {
  if (language === "my") {
    return "You are a helpful hotel assistant. Reply politely in Burmese. Use provided hotel information. Answer directly without analysis or internal reasoning. If the answer is not in the context, say you will check with the front desk.";
  }
  return "You are a helpful hotel assistant. Answer politely in English. Use the provided hotel information. Answer directly without analysis or internal reasoning. If the answer is not in the context, say you will check with the front desk.";
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

module.exports = {
  buildPrompt
};
