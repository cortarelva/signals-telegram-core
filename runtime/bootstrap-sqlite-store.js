require("dotenv").config();

const path = require("path");
const { readJsonSafe } = require("./file-utils");
const {
  getDb,
  mirrorJsonWrite,
  prunePathsOutside,
  replaceMirroredArray,
  SQLITE_DB_PATH,
  SQLITE_ENABLED,
} = require("./sqlite-store");

const RUNTIME_DIR = __dirname;
const PROJECT_ROOT = path.join(RUNTIME_DIR, "..");

const FILES = [
  { path: path.join(RUNTIME_DIR, "state.json"), type: "object" },
  { path: path.join(RUNTIME_DIR, "orders-log.json"), type: "array" },
  { path: path.join(RUNTIME_DIR, "execution-metrics.json"), type: "array" },
  { path: path.join(RUNTIME_DIR, "adaptive-history.json"), type: "array" },
  { path: path.join(RUNTIME_DIR, "performance-baseline.json"), type: "object" },
];

function main() {
  if (!SQLITE_ENABLED) {
    console.log("[SQLITE_BOOTSTRAP] SQLite mirror desativado por configuração.");
    return;
  }

  const db = getDb();
  if (!db) {
    throw new Error("SQLite indisponível; bootstrap abortado.");
  }

  console.log(`[SQLITE_BOOTSTRAP] DB: ${SQLITE_DB_PATH}`);
  prunePathsOutside(PROJECT_ROOT);

  for (const file of FILES) {
    const fallback = file.type === "array" ? [] : {};
    const data = readJsonSafe(file.path, fallback);

    if (file.type === "array") {
      replaceMirroredArray(file.path, Array.isArray(data) ? data : []);
      console.log(
        `[SQLITE_BOOTSTRAP] ${path.basename(file.path)} -> ${
          Array.isArray(data) ? data.length : 0
        } rows`
      );
    } else {
      mirrorJsonWrite(file.path, data || fallback);
      console.log(`[SQLITE_BOOTSTRAP] ${path.basename(file.path)} -> snapshot`);
    }
  }

  console.log("[SQLITE_BOOTSTRAP] concluído.");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("[SQLITE_BOOTSTRAP] erro:", err.message || err);
    process.exit(1);
  }
}

module.exports = { main };
