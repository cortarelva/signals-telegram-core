const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function loadFreshModules(dbPath) {
  process.env.SQLITE_MIRROR_ENABLED = "1";
  process.env.SQLITE_DB_PATH = dbPath;

  delete require.cache[require.resolve("../runtime/sqlite-store")];
  delete require.cache[require.resolve("../runtime/file-utils")];

  const sqliteStore = require("../runtime/sqlite-store");
  const fileUtils = require("../runtime/file-utils");
  const { DatabaseSync } = require("node:sqlite");

  return {
    sqliteStore,
    fileUtils,
    db: new DatabaseSync(dbPath),
  };
}

test("writeJsonAtomic mirrors state snapshots into SQLite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-mirror-"));
  const dbPath = path.join(dir, "runtime-store.sqlite");
  const statePath = path.join(dir, "state.json");
  const { fileUtils, db } = loadFreshModules(dbPath);

  const state = {
    openSignals: [{ id: 1 }],
    closedSignals: [{ id: 2 }, { id: 3 }],
    executions: [{ id: "exec-1" }],
    signalLog: [{ ts: 1 }, { ts: 2 }, { ts: 3 }],
  };

  fileUtils.writeJsonAtomic(statePath, state);

  const fileRow = db
    .prepare("SELECT file_name, payload_type, item_count FROM json_files WHERE path = ?")
    .get(path.resolve(statePath));
  const stateRow = db
    .prepare(
      "SELECT open_signals_count, closed_signals_count, executions_count, signal_log_count FROM state_latest WHERE path = ?"
    )
    .get(path.resolve(statePath));

  assert.equal(fileRow.file_name, "state.json");
  assert.equal(fileRow.payload_type, "object");
  assert.equal(fileRow.item_count, null);
  assert.equal(stateRow.open_signals_count, 1);
  assert.equal(stateRow.closed_signals_count, 2);
  assert.equal(stateRow.executions_count, 1);
  assert.equal(stateRow.signal_log_count, 3);
});

test("appendJsonArray mirrors orders log and execution metrics without duplicate first row", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-mirror-"));
  const dbPath = path.join(dir, "runtime-store.sqlite");
  const ordersPath = path.join(dir, "orders-log.json");
  const metricsPath = path.join(dir, "execution-metrics.json");
  const { fileUtils, db } = loadFreshModules(dbPath);

  fileUtils.appendJsonArray(ordersPath, {
    ts: 100,
    type: "futures_real_open",
    symbol: "ETHUSDC",
    direction: "LONG",
    linkedExecutionId: "exec-1",
  });
  fileUtils.appendJsonArray(ordersPath, {
    ts: 200,
    type: "futures_real_close",
    symbol: "ETHUSDC",
    direction: "LONG",
    linkedExecutionId: "exec-1",
  });

  fileUtils.appendJsonArray(metricsPath, {
    ts: 300,
    symbol: "ETHUSDC",
    executionId: "exec-1",
    slippagePct: 0.0012,
    latencyTotal: 450,
  });

  const ordersCount = db
    .prepare("SELECT COUNT(*) AS count FROM orders_log WHERE path = ?")
    .get(path.resolve(ordersPath)).count;
  const metricsCount = db
    .prepare("SELECT COUNT(*) AS count FROM execution_metrics WHERE path = ?")
    .get(path.resolve(metricsPath)).count;
  const latestOrder = db
    .prepare(
      "SELECT type, symbol, direction, linked_execution_id FROM orders_log WHERE path = ? ORDER BY logged_at DESC LIMIT 1"
    )
    .get(path.resolve(ordersPath));

  assert.equal(ordersCount, 2);
  assert.equal(metricsCount, 1);
  assert.equal(latestOrder.type, "futures_real_close");
  assert.equal(latestOrder.symbol, "ETHUSDC");
  assert.equal(latestOrder.direction, "LONG");
  assert.equal(latestOrder.linked_execution_id, "exec-1");
});
