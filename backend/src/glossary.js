const fs = require("fs");
const path = require("path");

const GLOSSARY_PATH = path.join(__dirname, "..", "data", "glossary.py");

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toJsonLike(text) {
  // Strip the leading assignment so the remainder is JSON-ish.
  const assignmentMatch = text.match(/\bGLOSSARY\s*=\s*([\s\S]*)$/);
  if (!assignmentMatch) return null;
  let literal = assignmentMatch[1].trim();
  // Remove trailing commas before } or ] to allow JSON.parse.
  literal = literal.replace(/,\s*([}\]])/g, "$1");
  return literal;
}

function loadGlossary() {
  try {
    const raw = fs.readFileSync(GLOSSARY_PATH, "utf8");
    const jsonLike = toJsonLike(raw);
    if (!jsonLike) return null;
    try {
      return JSON.parse(jsonLike);
    } catch (err) {
      // Fallback: attempt to parse as JS literal (handles single quotes).
      // Only used if JSON parsing fails.
      // eslint-disable-next-line no-new-func
      return Function(`"use strict"; return (${jsonLike});`)();
    }
  } catch (err) {
    return null;
  }
}

function buildRegex(terms) {
  if (!terms || terms.length === 0) return null;
  const patterns = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => {
      const normalized = String(term).replace(/\s+/g, " ").trim();
      const escaped = escapeRegex(normalized);
      const spaced = escaped.replace(/\s+/g, "\\s+");
      const isAscii = /^[\x00-\x7F]+$/.test(normalized);
      return isAscii ? `\\b${spaced}\\b` : spaced;
    });
  return new RegExp(patterns.join("|"), "gi");
}

function buildIndex(glossary) {
  if (!glossary || typeof glossary !== "object") return null;

  const maps = {
    en: new Map(),
    my: new Map(),
    enToMy: new Map(),
    myToEn: new Map()
  };

  for (const entry of Object.values(glossary)) {
    if (!entry || typeof entry !== "object") continue;
    const enList = Array.isArray(entry.en) ? entry.en.filter(Boolean) : [];
    const myList = Array.isArray(entry.my) ? entry.my.filter(Boolean) : [];
    const canonicalEn = enList[0];
    const canonicalMy = myList[0];

    for (const term of enList) {
      const key = normalizeKey(term);
      if (!maps.en.has(key) && canonicalEn) maps.en.set(key, canonicalEn);
      if (!maps.enToMy.has(key) && canonicalMy) maps.enToMy.set(key, canonicalMy);
    }

    for (const term of myList) {
      const key = normalizeKey(term);
      if (!maps.my.has(key) && canonicalMy) maps.my.set(key, canonicalMy);
      if (!maps.myToEn.has(key) && canonicalEn) maps.myToEn.set(key, canonicalEn);
    }
  }

  const combined = {
    en: new Map([...maps.en.entries(), ...maps.myToEn.entries()]),
    my: new Map([...maps.my.entries(), ...maps.enToMy.entries()])
  };

  const regexes = {
    en: buildRegex(Array.from(combined.en.keys())),
    my: buildRegex(Array.from(combined.my.keys()))
  };

  return { combined, regexes };
}

const glossaryData = loadGlossary();
const glossaryIndex = buildIndex(glossaryData);

function applyGlossary(text, targetLang = "en") {
  if (!text || !glossaryIndex) return text;
  const lang = targetLang === "my" ? "my" : "en";
  const regex = glossaryIndex.regexes[lang];
  const map = glossaryIndex.combined[lang];
  if (!regex || !map || map.size === 0) return text;

  return String(text).replace(regex, (match) => {
    const key = normalizeKey(match);
    return map.get(key) || match;
  });
}

module.exports = {
  applyGlossary
};
