const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRecentRiskSnapshot,
  canExecute,
  deriveProjectedSignalNotionalUsd,
  deriveProjectedSignalRiskUsd,
} = require("../runtime/risk-manager");

test("deriveProjectedSignalSizing respects max position cap", () => {
  const signal = {
    symbol: "ETHUSDC",
    entry: 100,
    sl: 99,
  };

  const projectedNotional = deriveProjectedSignalNotionalUsd(signal, {
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
  });
  const projectedRisk = deriveProjectedSignalRiskUsd(signal, {
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
  });

  assert.equal(projectedNotional, 40);
  assert.equal(projectedRisk, 0.4);
});

test("canExecute blocks duplicate positions", () => {
  const signal = {
    symbol: "ETHUSDC",
    tf: "15m",
    side: "BUY",
    direction: "LONG",
    signalClass: "EXECUTABLE",
    score: 80,
    entry: 100,
    sl: 99,
  };
  const state = {
    executions: [
      {
        status: "OPEN",
        symbol: "ETHUSDC",
        tf: "15m",
        side: "BUY",
        direction: "LONG",
        positionNotional: 40,
      },
    ],
  };

  const result = canExecute(signal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "duplicate_open_trade");
});

test("canExecute enforces same-side notional limits without blocking opposite side", () => {
  const state = {
    executions: [
      {
        status: "OPEN",
        symbol: "BNBUSDC",
        tf: "15m",
        side: "SELL",
        direction: "SHORT",
        positionNotional: 40,
      },
    ],
  };

  const shortSignal = {
    symbol: "ETHUSDC",
    tf: "15m",
    side: "SELL",
    direction: "SHORT",
    signalClass: "EXECUTABLE",
    score: 82,
    entry: 100,
    sl: 101,
  };
  const longSignal = {
    ...shortSignal,
    side: "BUY",
    direction: "LONG",
    sl: 99,
  };

  const shortResult = canExecute(shortSignal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
    maxSideNotionalUsd: 60,
  });
  const longResult = canExecute(longSignal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
    maxSideNotionalUsd: 60,
  });

  assert.equal(shortResult.ok, false);
  assert.equal(shortResult.reason, "side_notional_limit_reached");
  assert.equal(longResult.ok, true);
});

test("buildRecentRiskSnapshot tracks rolling net loss and loss streak", () => {
  const now = Date.UTC(2026, 3, 27, 12, 0, 0);
  const hour = 60 * 60 * 1000;
  const state = {
    executions: [
      {
        status: "CLOSED",
        closedTs: now - 5 * hour,
        pnlUsd: -0.4,
      },
      {
        status: "CLOSED",
        closedTs: now - 2 * hour,
        pnlUsd: -0.3,
      },
      {
        status: "CLOSED",
        closedTs: now - 30 * 60 * 1000,
        pnlUsd: -0.2,
      },
    ],
  };

  const snapshot = buildRecentRiskSnapshot(state, {
    currentTs: now,
    rollingLossLookbackHours: 24,
    maxRollingNetLossUsd: 0.5,
    maxConsecutiveLosses: 2,
    lossStreakCooldownMins: 180,
  });

  assert.ok(Math.abs(snapshot.rollingNetPnlUsd + 0.9) < 1e-9);
  assert.equal(snapshot.rollingLossLimitReached, true);
  assert.equal(snapshot.consecutiveLosses, 3);
  assert.equal(snapshot.lossStreakCooldownActive, true);
});

test("canExecute blocks on rolling loss and then releases after streak cooldown", () => {
  const now = Date.UTC(2026, 3, 27, 12, 0, 0);
  const minute = 60 * 1000;
  const signal = {
    symbol: "BTCUSDC",
    tf: "1h",
    side: "SELL",
    direction: "SHORT",
    signalClass: "EXECUTABLE",
    score: 84,
    entry: 100,
    sl: 101,
  };
  const state = {
    executions: [
      {
        status: "CLOSED",
        closedTs: now - 90 * minute,
        pnlUsd: -0.4,
      },
      {
        status: "CLOSED",
        closedTs: now - 30 * minute,
        pnlUsd: -0.35,
      },
    ],
  };

  const blockedByRollingLoss = canExecute(signal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
    maxRollingNetLossUsd: 0.5,
    currentTs: now,
  });

  assert.equal(blockedByRollingLoss.ok, false);
  assert.equal(blockedByRollingLoss.reason, "rolling_loss_limit_reached");

  const blockedByStreak = canExecute(signal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
    maxConsecutiveLosses: 2,
    lossStreakCooldownMins: 180,
    currentTs: now,
  });

  assert.equal(blockedByStreak.ok, false);
  assert.equal(blockedByStreak.reason, "loss_streak_cooldown_active");

  const releasedAfterCooldown = canExecute(signal, state, {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 4,
    maxOpenTradesPerSymbol: 2,
    accountSize: 1000,
    riskPerTrade: 0.01,
    maxPositionUsd: 40,
    maxConsecutiveLosses: 2,
    lossStreakCooldownMins: 180,
    currentTs: now + 4 * 60 * minute,
  });

  assert.equal(releasedAfterCooldown.ok, true);
});
