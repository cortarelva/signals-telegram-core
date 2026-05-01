const fs = require("fs");
const path = require("path");
const {
  mirrorJsonArrayAppend,
  mirrorJsonWrite,
} = require("./sqlite-store");

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureParentDir(filePath);

  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  fs.writeFileSync(tempFile, payload, "utf8");
  fs.renameSync(tempFile, filePath);
  mirrorJsonWrite(filePath, value);
}

function appendJsonArray(filePath, entry) {
  const rows = readJsonSafe(filePath, []);
  const list = Array.isArray(rows) ? rows : [];
  list.push(entry);
  writeJsonAtomic(filePath, list);
  mirrorJsonArrayAppend(filePath, entry, list);
  return list;
}

module.exports = {
  appendJsonArray,
  readJsonSafe,
  writeJsonAtomic,
};
