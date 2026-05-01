const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isStrongCandidate,
  pickBestCandidate,
  buildPresetMeta,
  buildPresetFile,
} = require("../research/optimize-tradfi-preset");

test("pickBestCandidate prefers a robust setup over a raw one-trade outlier", () => {
  const candidates = [
    {
      strategy: "range",
      profile: { tf: "15m", htfTf: "1d" },
      summary: { trades: 1, avgPnlPct: 0.30, profitFactor: 999, winrate: 100 },
    },
    {
      strategy: "oversoldBounce",
      profile: { tf: "30m", htfTf: "1d" },
      summary: { trades: 5, avgPnlPct: 0.22, profitFactor: 999, winrate: 100 },
    },
  ];

  assert.equal(isStrongCandidate(candidates[0]), false);
  assert.equal(isStrongCandidate(candidates[1]), true);
  assert.equal(pickBestCandidate(candidates).strategy, "oversoldBounce");
});

test("buildPresetMeta keeps a single symbol timeframe when all enabled strategies agree", () => {
  const enabledStrategies = {
    OVERSOLD_BOUNCE: {
      profile: { tf: "30m", htfTf: "1d" },
    },
  };

  assert.deepEqual(buildPresetMeta(enabledStrategies, enabledStrategies.OVERSOLD_BOUNCE), {
    tf: "30m",
    htfTf: "1d",
    profileMode: "single",
    profiles: [{ tf: "30m", htfTf: "1d" }],
  });
});

test("buildPresetMeta marks mixed per-strategy profiles explicitly", () => {
  const enabledStrategies = {
    BULL_TRAP: {
      profile: { tf: "1h", htfTf: "1d" },
    },
    BREAKDOWN_RETEST_SHORT: {
      profile: { tf: "30m", htfTf: "1d" },
    },
  };
  const best = enabledStrategies.BULL_TRAP;

  assert.deepEqual(buildPresetMeta(enabledStrategies, best), {
    tf: null,
    htfTf: null,
    profileMode: "per-strategy",
    profiles: [
      { tf: "1h", htfTf: "1d" },
      { tf: "30m", htfTf: "1d" },
    ],
    defaultTf: "1h",
    defaultHtfTf: "1d",
  });
});

test("buildPresetFile preserves per-strategy profile metadata for mixed symbols", () => {
  const summary = {
    generatedAt: "2026-04-21T22:05:54.388Z",
    recommendations: {
      XAUUSDT: {
        best: {
          strategy: "bullTrap",
          profile: { tf: "1h", htfTf: "1d" },
          summary: { trades: 16, avgPnlPct: 0.28, profitFactor: 2.31, winrate: 75 },
        },
        preset: {
          tf: null,
          htfTf: null,
          profileMode: "per-strategy",
          profiles: [
            { tf: "1h", htfTf: "1d" },
            { tf: "30m", htfTf: "1d" },
          ],
          defaultTf: "1h",
          defaultHtfTf: "1d",
          strategies: {
            BULL_TRAP: {
              enabled: true,
              sourceStrategy: "bullTrap",
              tf: "1h",
              htfTf: "1d",
              trades: 16,
              avgPnlPct: 0.28,
              profitFactor: 2.31,
              winrate: 75,
            },
          },
        },
      },
    },
  };

  assert.deepEqual(buildPresetFile(summary), {
    generatedAt: "2026-04-21T22:05:54.388Z",
    symbols: {
      AAPLUSDT: {
        status: "no-signal",
      },
      QQQUSDT: {
        status: "no-signal",
      },
      SPYUSDT: {
        status: "no-signal",
      },
      XAUUSDT: {
        tf: null,
        htfTf: null,
        profileMode: "per-strategy",
        profiles: [
          { tf: "1h", htfTf: "1d" },
          { tf: "30m", htfTf: "1d" },
        ],
        defaultTf: "1h",
        defaultHtfTf: "1d",
        strategies: {
          BULL_TRAP: {
            enabled: true,
            sourceStrategy: "bullTrap",
            tf: "1h",
            htfTf: "1d",
            trades: 16,
            avgPnlPct: 0.28,
            profitFactor: 2.31,
            winrate: 75,
          },
        },
      },
    },
  });
});
