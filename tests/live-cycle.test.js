const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function loadFreshCoreAndExecutor() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-cycle-"));
  process.env.EXECUTION_MODE = "paper";
  process.env.BREAK_EVEN_ENABLED = "1";
  process.env.BREAK_EVEN_TRIGGER_R = "0.5";
  process.env.BREAK_EVEN_LOCK_R = "0.1";
  process.env.BREAK_EVEN_MIN_BARS = "1";
  process.env.FUTURES_ATTACH_TPSL_ON_ENTRY = "0";
  process.env.SQLITE_MIRROR_ENABLED = "0";
  process.env.STATE_FILE_PATH = path.join(dir, "state.json");
  process.env.ORDERS_LOG_FILE_PATH = path.join(dir, "orders-log.json");
  process.env.EXECUTION_METRICS_FILE_PATH = path.join(
    dir,
    "execution-metrics.json"
  );

  delete require.cache[require.resolve("../runtime/futures-executor")];
  delete require.cache[require.resolve("../runtime/signals-telegram-core")];

  const executor = require("../runtime/futures-executor");
  const core = require("../runtime/signals-telegram-core");

  return { executor, core };
}

test("signals core can be imported without auto-starting and exposes testable hooks", () => {
  const { core } = loadFreshCoreAndExecutor();

  assert.equal(typeof core.updateTracker, "function");
  assert.equal(typeof core.shouldSendSignal, "function");
  assert.equal(typeof core.processSymbol, "function");
});

test("shouldSendSignal blocks cooldown and near-duplicate entries", () => {
  const { core } = loadFreshCoreAndExecutor();
  const now = Date.now();
  const state = {
    lastSignal: {
      ETHUSDC_15m: {
        ts: now - 5 * 60 * 1000,
        entry: 100,
      },
    },
  };

  assert.equal(
    core.shouldSendSignal(
      state,
      { symbol: "ETHUSDC", tf: "15m", ts: now, entry: 100.2 },
      10
    ),
    false
  );

  assert.equal(
    core.shouldSendSignal(
      {
        lastSignal: {
          ETHUSDC_15m: {
            ts: now - 20 * 60 * 1000,
            entry: 100,
          },
        },
      },
      { symbol: "ETHUSDC", tf: "15m", ts: now, entry: 100.03 },
      10
    ),
    false
  );

  assert.equal(
    core.shouldSendSignal(
      {
        lastSignal: {
          ETHUSDC_15m: {
            ts: now - 20 * 60 * 1000,
            entry: 100,
          },
        },
      },
      { symbol: "ETHUSDC", tf: "15m", ts: now, entry: 100.2 },
      10
    ),
    true
  );
});

test("paper live-cycle applies break-even then closes execution consistently", async () => {
  const { executor, core } = loadFreshCoreAndExecutor();
  const state = {
    lastSignal: {},
    openSignals: [],
    closedSignals: [],
    executions: [],
    signalLog: [],
  };

  const signal = {
    symbol: "ETHUSDC",
    tf: "15m",
    strategy: "trend",
    direction: "LONG",
    side: "BUY",
    entry: 100,
    sl: 99,
    tp: 102,
    score: 82,
    signalClass: "EXECUTABLE",
    ts: Date.now(),
    initialRisk: 1,
    maxHighDuringTrade: 100,
    minLowDuringTrade: 100,
    barsOpen: 0,
    signalCandleCloseTime: 1_000,
    openedOnCandleCloseTime: 1_000,
    lastTrackedCandleCloseTime: 1_000,
  };

  const openResult = await executor.paperExecute(signal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 5,
    maxOpenTradesPerSymbol: 1,
    allowedSymbols: ["ETHUSDC"],
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
  });

  assert.equal(openResult.executed, true);
  assert.ok(openResult.order?.id);

  signal.executionOrderId = openResult.order.id;
  state.executions.push(openResult.order);
  state.openSignals.push(signal);

  const firstPass = await core.updateTracker(state, {
    symbol: "ETHUSDC",
    tf: "15m",
    candleHigh: 100.6,
    candleLow: 99.8,
    candleClose: 100.4,
    candleCloseTime: 2_000,
  });

  assert.equal(firstPass.length, 0);
  assert.equal(state.openSignals.length, 1);
  assert.equal(state.openSignals[0].barsOpen, 1);
  assert.equal(state.executions[0].breakEvenApplied, true);
  assert.ok(Number(state.executions[0].sl) > 100);

  const adjustedStop = Number(state.executions[0].sl);

  const duplicatePass = await core.updateTracker(state, {
    symbol: "ETHUSDC",
    tf: "15m",
    candleHigh: 100.6,
    candleLow: 99.8,
    candleClose: 100.4,
    candleCloseTime: 2_000,
  });

  assert.equal(duplicatePass.length, 0);
  assert.equal(state.openSignals[0].barsOpen, 1);

  const secondPass = await core.updateTracker(state, {
    symbol: "ETHUSDC",
    tf: "15m",
    candleHigh: 100.3,
    candleLow: adjustedStop - 0.01,
    candleClose: adjustedStop,
    candleCloseTime: 3_000,
  });

  assert.equal(secondPass.length, 1);
  assert.equal(state.openSignals.length, 0);
  assert.equal(state.closedSignals.length, 1);
  assert.equal(state.closedSignals[0].outcome, "SL");

  const closedExecution = await executor.closeExecutionForSignal(
    state,
    state.closedSignals[0]
  );

  assert.equal(closedExecution.status, "CLOSED");
  assert.equal(closedExecution.closeReason, "SL");
  assert.ok(Number(closedExecution.exitPrice) > 100);
  assert.ok(Number(closedExecution.pnlPct) >= 0);
});

test("binance-real tracker updates attached stop on exchange when break-even triggers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-cycle-real-"));
  process.env.EXECUTION_MODE = "binance_real";
  process.env.BREAK_EVEN_ENABLED = "1";
  process.env.BREAK_EVEN_TRIGGER_R = "0.4";
  process.env.BREAK_EVEN_LOCK_R = "0.02";
  process.env.BREAK_EVEN_MIN_BARS = "1";
  process.env.FUTURES_ATTACH_TPSL_ON_ENTRY = "1";
  process.env.SQLITE_MIRROR_ENABLED = "0";
  process.env.STATE_FILE_PATH = path.join(dir, "state.json");
  process.env.ORDERS_LOG_FILE_PATH = path.join(dir, "orders-log.json");
  process.env.EXECUTION_METRICS_FILE_PATH = path.join(
    dir,
    "execution-metrics.json"
  );

  delete require.cache[require.resolve("../runtime/futures-executor")];
  delete require.cache[require.resolve("../runtime/signals-telegram-core")];

  const executor = require("../runtime/futures-executor");
  const core = require("../runtime/signals-telegram-core");
  const calls = [];

  executor.moveExecutionStopToBreakEven = async (execution, newStopPrice, meta) => {
    calls.push({ executionId: execution.id, newStopPrice, meta });
    execution.exchange = execution.exchange || {};
    execution.exchange.slStopPrice = Number(newStopPrice);
    execution.sl = Number(newStopPrice);
    return {
      ok: true,
      previousStopPrice: 99,
      stopPrice: Number(newStopPrice),
    };
  };

  const signal = {
    symbol: "ETHUSDC",
    tf: "1h",
    strategy: "cipherContinuationShort",
    direction: "SHORT",
    side: "SELL",
    entry: 100,
    sl: 101,
    tp: 98,
    score: 92,
    signalClass: "EXECUTABLE",
    ts: Date.now(),
    initialRisk: 1,
    maxHighDuringTrade: 100,
    minLowDuringTrade: 100,
    barsOpen: 0,
    signalCandleCloseTime: 1_000,
    openedOnCandleCloseTime: 1_000,
    lastTrackedCandleCloseTime: 1_000,
  };

  const execution = {
    id: "exec-eth-short",
    status: "OPEN",
    symbol: "ETHUSDC",
    tf: "1h",
    direction: "SHORT",
    entry: 100,
    sl: 101,
    tp: 98,
    quantity: 1,
    exchange: {
      attachedExitsPlaced: true,
      slAlgoId: 123,
      slOrderId: 123,
      slStopPrice: 101,
    },
  };

  signal.executionOrderId = execution.id;
  const state = {
    lastSignal: {},
    openSignals: [signal],
    closedSignals: [],
    executions: [execution],
    signalLog: [],
  };

  const firstPass = await core.updateTracker(state, {
    symbol: "ETHUSDC",
    tf: "1h",
    candleHigh: 100.2,
    candleLow: 99.59,
    candleClose: 99.8,
    candleCloseTime: 2_000,
  });

  assert.equal(firstPass.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executionId, "exec-eth-short");
  assert.ok(Number(state.openSignals[0].sl) < 100);
  assert.equal(state.openSignals[0].breakEvenApplied, true);
  assert.equal(state.executions[0].breakEvenApplied, true);
});
