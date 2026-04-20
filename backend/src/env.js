const path = require("path");
const dotenv = require("dotenv");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Ensure repo .env values win over stale shell/session environment variables.
dotenv.config({ path: path.join(REPO_ROOT, ".env"), override: true });

function resolveRepoPath(rawValue, fallbackSegments = []) {
  const value = rawValue && String(rawValue).trim();
  if (!value) {
    return path.join(REPO_ROOT, ...fallbackSegments);
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(REPO_ROOT, value);
}

module.exports = {
  REPO_ROOT,
  resolveRepoPath
};
