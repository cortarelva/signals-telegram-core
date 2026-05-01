const path = require("path");

const SQLITE_ENABLED =
  String(process.env.SQLITE_MIRROR_ENABLED ?? "1") === "1";
const SQLITE_DB_PATH =
  process.env.SQLITE_DB_PATH || path.join(__dirname, "runtime-store.sqlite");

let DatabaseSync = null;
let database = null;
let warned = false;

function warnOnce(message, err = null) {
  if (warned) return;
  warned = true;
  console.warn(
    `[SQLITE_MIRROR] ${message}`,
    err ? err.message || err : ""
  );
}

function tryLoadSqlite() {
  if (DatabaseSync) return true;

  try {
    ({ DatabaseSync } = require("node:sqlite"));
    return true;
  } catch (err) {
    warnOnce("node:sqlite indisponível; mirror desativado.", err);
    return false;
  }
}

function getDb() {
  if (!SQLITE_ENABLED) return null;
  if (database) return database;
  if (!tryLoadSqlite()) return null;

  try {
    database = new DatabaseSync(SQLITE_DB_PATH);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS json_files (
        path TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_type TEXT NOT NULL,
        item_count INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS state_latest (
        path TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        open_signals_count INTEGER NOT NULL,
        closed_signals_count INTEGER NOT NULL,
        executions_count INTEGER NOT NULL,
        signal_log_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        logged_at INTEGER NOT NULL,
        type TEXT,
        symbol TEXT,
        direction TEXT,
        linked_execution_id TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_log_path_time
        ON orders_log(path, logged_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_log_symbol_time
        ON orders_log(symbol, logged_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_log_execution
        ON orders_log(linked_execution_id);

      CREATE TABLE IF NOT EXISTS execution_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        logged_at INTEGER NOT NULL,
        symbol TEXT,
        execution_id TEXT,
        slippage_pct REAL,
        latency_total REAL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_execution_metrics_path_time
        ON execution_metrics(path, logged_at DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_metrics_symbol_time
        ON execution_metrics(symbol, logged_at DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_metrics_execution
        ON execution_metrics(execution_id);

      CREATE TABLE IF NOT EXISTS json_array_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        logged_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_json_array_events_path_time
        ON json_array_events(path, logged_at DESC);
    `);
  } catch (err) {
    warnOnce("falha ao inicializar base SQLite.", err);
    database = null;
  }

  return database;
}

function toJson(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function toItemCount(value) {
  return Array.isArray(value) ? value.length : null;
}

function tryParseObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function upsertJsonFile(db, filePath, value, now = Date.now()) {
  const resolvedPath = path.resolve(filePath);
  const payloadJson = toJson(value);
  const fileName = path.basename(filePath);
  const payloadType = Array.isArray(value) ? "array" : typeof value;
  const itemCount = toItemCount(value);

  db.prepare(`
    INSERT INTO json_files (
      path, file_name, payload_json, payload_type, item_count, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      file_name = excluded.file_name,
      payload_json = excluded.payload_json,
      payload_type = excluded.payload_type,
      item_count = excluded.item_count,
      updated_at = excluded.updated_at
  `).run(
    resolvedPath,
    fileName,
    payloadJson,
    payloadType,
    itemCount,
    now
  );

  return payloadJson;
}

function upsertStateLatest(db, filePath, value, now = Date.now()) {
  const resolvedPath = path.resolve(filePath);
  const state = tryParseObject(value) || {};
  const payloadJson = toJson(state);

  db.prepare(`
    INSERT INTO state_latest (
      path,
      updated_at,
      open_signals_count,
      closed_signals_count,
      executions_count,
      signal_log_count,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      updated_at = excluded.updated_at,
      open_signals_count = excluded.open_signals_count,
      closed_signals_count = excluded.closed_signals_count,
      executions_count = excluded.executions_count,
      signal_log_count = excluded.signal_log_count,
      payload_json = excluded.payload_json
  `).run(
    resolvedPath,
    now,
    Array.isArray(state.openSignals) ? state.openSignals.length : 0,
    Array.isArray(state.closedSignals) ? state.closedSignals.length : 0,
    Array.isArray(state.executions) ? state.executions.length : 0,
    Array.isArray(state.signalLog) ? state.signalLog.length : 0,
    payloadJson
  );
}

function mirrorJsonWrite(filePath, value) {
  const db = getDb();
  if (!db) return false;

  try {
    const now = Date.now();
    const fileName = path.basename(filePath);
    db.exec("BEGIN IMMEDIATE");
    upsertJsonFile(db, filePath, value, now);
    if (fileName === "state.json") {
      upsertStateLatest(db, filePath, value, now);
    }
    db.exec("COMMIT");
    return true;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    warnOnce(`falha a espelhar escrita de ${path.basename(filePath)}.`, err);
    return false;
  }
}

function insertOrderLogRow(db, filePath, row, now = Date.now()) {
  const payloadJson = toJson(row);
  db.prepare(`
    INSERT INTO orders_log (
      path,
      logged_at,
      type,
      symbol,
      direction,
      linked_execution_id,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    path.resolve(filePath),
    Number(row?.ts || now),
    row?.type || null,
    row?.symbol || null,
    row?.direction || row?.side || null,
    row?.linkedExecutionId || row?.executionId || null,
    payloadJson
  );
}

function insertExecutionMetricRow(db, filePath, row, now = Date.now()) {
  const payloadJson = toJson(row);
  db.prepare(`
    INSERT INTO execution_metrics (
      path,
      logged_at,
      symbol,
      execution_id,
      slippage_pct,
      latency_total,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    path.resolve(filePath),
    Number(row?.ts || now),
    row?.symbol || null,
    row?.executionId || row?.linkedExecutionId || null,
    Number.isFinite(Number(row?.slippagePct)) ? Number(row.slippagePct) : null,
    Number.isFinite(Number(row?.latencyTotal)) ? Number(row.latencyTotal) : null,
    payloadJson
  );
}

function insertGenericArrayEvent(db, filePath, row, now = Date.now()) {
  db.prepare(`
    INSERT INTO json_array_events (
      path,
      file_name,
      logged_at,
      payload_json
    )
    VALUES (?, ?, ?, ?)
  `).run(
    path.resolve(filePath),
    path.basename(filePath),
    Number(row?.ts || now),
    toJson(row)
  );
}

function countRows(db, tableName, filePath) {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE path = ?`)
    .get(path.resolve(filePath));
  return Number(row?.count || 0);
}

function backfillArrayTable(db, filePath, rows, fileName) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return false;

  if (fileName === "orders-log.json" && countRows(db, "orders_log", filePath) === 0) {
    for (const row of list) insertOrderLogRow(db, filePath, row);
    return true;
  }

  if (
    fileName === "execution-metrics.json" &&
    countRows(db, "execution_metrics", filePath) === 0
  ) {
    for (const row of list) insertExecutionMetricRow(db, filePath, row);
    return true;
  }

  return false;
}

function mirrorJsonArrayAppend(filePath, entry, nextList) {
  const db = getDb();
  if (!db) return false;

  try {
    const now = Date.now();
    const fileName = path.basename(filePath);
    db.exec("BEGIN IMMEDIATE");
    upsertJsonFile(db, filePath, nextList, now);
    const backfilled = backfillArrayTable(db, filePath, nextList, fileName);

    if (!backfilled && fileName === "orders-log.json") {
      insertOrderLogRow(db, filePath, entry, now);
    } else if (!backfilled && fileName === "execution-metrics.json") {
      insertExecutionMetricRow(db, filePath, entry, now);
    } else if (!backfilled) {
      insertGenericArrayEvent(db, filePath, entry, now);
    }

    db.exec("COMMIT");
    return true;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    warnOnce(`falha a espelhar append de ${path.basename(filePath)}.`, err);
    return false;
  }
}

function replaceMirroredArray(filePath, rows) {
  const db = getDb();
  if (!db) return false;

  try {
    const now = Date.now();
    const list = Array.isArray(rows) ? rows : [];
    const fileName = path.basename(filePath);

    db.exec("BEGIN IMMEDIATE");
    upsertJsonFile(db, filePath, list, now);

    if (fileName === "orders-log.json") {
      db.prepare("DELETE FROM orders_log WHERE path = ?").run(path.resolve(filePath));
      for (const row of list) insertOrderLogRow(db, filePath, row, now);
    } else if (fileName === "execution-metrics.json") {
      db.prepare("DELETE FROM execution_metrics WHERE path = ?").run(path.resolve(filePath));
      for (const row of list) insertExecutionMetricRow(db, filePath, row, now);
    } else {
      db.prepare("DELETE FROM json_array_events WHERE path = ?").run(path.resolve(filePath));
      for (const row of list) insertGenericArrayEvent(db, filePath, row, now);
    }

    db.exec("COMMIT");
    return true;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    warnOnce(`falha a substituir espelho de ${path.basename(filePath)}.`, err);
    return false;
  }
}

function prunePathsOutside(baseDir) {
  const db = getDb();
  if (!db) return false;

  try {
    const prefix = `${path.resolve(baseDir)}%`;
    db.exec("BEGIN IMMEDIATE");
    for (const table of [
      "json_files",
      "state_latest",
      "orders_log",
      "execution_metrics",
      "json_array_events",
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE path NOT LIKE ?`).run(prefix);
    }
    db.exec("COMMIT");
    return true;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    warnOnce("falha ao limpar paths externos do espelho SQLite.", err);
    return false;
  }
}

module.exports = {
  getDb,
  mirrorJsonArrayAppend,
  mirrorJsonWrite,
  prunePathsOutside,
  replaceMirroredArray,
  SQLITE_DB_PATH,
  SQLITE_ENABLED,
};
