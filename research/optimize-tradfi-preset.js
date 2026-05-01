require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const RUNNER = path.join(__dirname, "backtest-tradfi-candidates.js");
const LATEST_OUTPUT = path.join(__dirname, "tradfi-candidate-strategy-backtest.json");
const OUTPUT_DIR = path.join(__dirname, "cache", "tradfi-optimization");
const SUMMARY_FILE = path.join(__dirname, "tradfi-preset-recommendations.json");
const PRESET_FILE = path.join(__dirname, "tradfi-preset.json");

const SYMBOLS = ["AAPLUSDT", "QQQUSDT", "SPYUSDT", "XAUUSDT"];
const STRATEGY_KEY_MAP = {
  oversoldBounce: "OVERSOLD_BOUNCE",
  breakdownRetestShort: "BREAKDOWN_RETEST_SHORT",
  bullTrap: "BULL_TRAP",
  failedBreakdown: "FAILED_BREAKDOWN",
  liquiditySweepReclaimLong: "LIQUIDITY_SWEEP_RECLAIM_LONG",
  momentumBreakoutLong: "MOMENTUM_BREAKOUT_LONG",
  range: "RANGE",
};

const PROFILES = [
  { label: "15m_1d", tf: "15m", htfTf: "1d", ltfLimit: 3000, htfLimit: 400 },
  { label: "30m_1d", tf: "30m", htfTf: "1d", ltfLimit: 2500, htfLimit: 400 },
  { label: "1h_1d", tf: "1h", htfTf: "1d", ltfLimit: 2200, htfLimit: 400 },
  { label: "4h_1d", tf: "4h", htfTf: "1d", ltfLimit: 1500, htfLimit: 400 },
  {
    label: "30m_1d_equity_reversal",
    tf: "30m",
    htfTf: "1d",
    ltfLimit: 2500,
    htfLimit: 400,
    configOverrides: {
      DEFAULTS: {
        OVERSOLD_BOUNCE: {
          enabled: true,
          minScore: 55,
          minAdx: 0,
          maxRsi: 48,
          minRsiRecovery: 0.6,
          minDropAtr: 0.9,
          minBullRecoveryBodyAtr: 0.08,
          minRelativeVolume: 0.95,
          requireVolume: false,
          slAtrMult: 1.0,
          tpAtrMult: 1.45,
          minRrAfterCap: 0.6,
          minTpPctAfterCap: 0.0007,
          minTpAtrAfterCap: 0.3,
        },
        FAILED_BREAKDOWN: {
          enabled: true,
          minScore: 58,
          minAdx: 0,
          maxAdx: 32,
          maxRsi: 58,
          minRsiRecovery: 0.4,
          minBreakAtr: 0.04,
          minRecoveryCloseAtr: 0.04,
          minBullBodyAtr: 0.06,
          minLowerWickAtr: 0.08,
          requireVolume: false,
          minRelativeVolume: 0.95,
          tpAtrMult: 1.5,
          minRrAfterCap: 0.65,
          minTpPctAfterCap: 0.0008,
          minTpAtrAfterCap: 0.35,
        },
      },
    },
  },
  {
    label: "1h_1d_equity_reversal",
    tf: "1h",
    htfTf: "1d",
    ltfLimit: 2200,
    htfLimit: 400,
    configOverrides: {
      DEFAULTS: {
        OVERSOLD_BOUNCE: {
          enabled: true,
          minScore: 55,
          minAdx: 0,
          maxRsi: 50,
          minRsiRecovery: 0.5,
          minDropAtr: 0.8,
          minBullRecoveryBodyAtr: 0.06,
          minRelativeVolume: 0.9,
          requireVolume: false,
          slAtrMult: 1.0,
          tpAtrMult: 1.4,
          minRrAfterCap: 0.6,
          minTpPctAfterCap: 0.0007,
          minTpAtrAfterCap: 0.3,
        },
        FAILED_BREAKDOWN: {
          enabled: true,
          minScore: 58,
          minAdx: 0,
          maxAdx: 34,
          maxRsi: 60,
          minRsiRecovery: 0.35,
          minBreakAtr: 0.03,
          minRecoveryCloseAtr: 0.03,
          minBullBodyAtr: 0.05,
          minLowerWickAtr: 0.07,
          requireVolume: false,
          minRelativeVolume: 0.9,
          tpAtrMult: 1.45,
          minRrAfterCap: 0.6,
          minTpPctAfterCap: 0.0007,
          minTpAtrAfterCap: 0.3,
        },
      },
    },
  },
  {
    label: "30m_1d_equity_breakout",
    tf: "30m",
    htfTf: "1d",
    ltfLimit: 2500,
    htfLimit: 400,
    configOverrides: {
      DEFAULTS: {
        BREAKDOWN_RETEST_SHORT: {
          enabled: true,
          minScore: 58,
          minAdx: 5,
          maxAdx: 40,
          minBreakAtr: 0.05,
          maxRetestDistAtr: 0.45,
          minRejectBodyAtr: 0.06,
          requireRsiFalling: false,
          maxRsi: 62,
          requireVolume: false,
          minRelativeVolume: 0.95,
          tpAtrMult: 1.6,
          minRrAfterCap: 0.65,
          minTpPctAfterCap: 0.0008,
        },
        BULL_TRAP: {
          enabled: true,
          minScore: 58,
          minAdx: 5,
          maxAdx: 42,
          minBreakAtr: 0.04,
          minRejectionBodyAtr: 0.05,
          minUpperWickAtr: 0.08,
          minRsiFade: 0.3,
          maxRsiAfterReject: 66,
          requireVolume: false,
          minRelativeVolume: 0.95,
          tpAtrMult: 1.5,
          minRrAfterCap: 0.65,
          minTpPctAfterCap: 0.0008,
        },
      },
    },
    envOverrides: {
      MOMENTUM_BREAKOUT_LONG_ENABLED: "1",
      MOMENTUM_BREAKOUT_MIN_SCORE: "55",
      MOMENTUM_BREAKOUT_LOOKBACK_CANDLES: "10",
      MOMENTUM_BREAKOUT_MIN_ADX: "4",
      MOMENTUM_BREAKOUT_MAX_ADX: "35",
      MOMENTUM_BREAKOUT_MIN_BODY_ATR: "0.08",
      MOMENTUM_BREAKOUT_MIN_BREAKOUT_CLOSE_ATR: "0.02",
      MOMENTUM_BREAKOUT_MIN_BASE_TIGHTNESS_ATR: "0.20",
      MOMENTUM_BREAKOUT_MAX_BASE_RANGE_ATR: "1.40",
      MOMENTUM_BREAKOUT_MAX_BASE_DRIFT_ATR: "1.60",
      MOMENTUM_BREAKOUT_MAX_DIST_EMA20_ATR: "1.80",
      MOMENTUM_BREAKOUT_MIN_RELATIVE_VOLUME: "1.00",
      MOMENTUM_BREAKOUT_MIN_RSI: "50",
      MOMENTUM_BREAKOUT_MAX_RSI: "68",
      MOMENTUM_BREAKOUT_MIN_RSI_RECOVERY: "0.10",
      MOMENTUM_BREAKOUT_REQUIRE_ABOVE_EMA20: "1",
      MOMENTUM_BREAKOUT_REQUIRE_ABOVE_EMA50: "0",
      MOMENTUM_BREAKOUT_REQUIRE_BULLISH_FAST: "0",
      MOMENTUM_BREAKOUT_TP_ATR_MULT: "1.20",
      MOMENTUM_BREAKOUT_MIN_RR_AFTER_CAP: "0.60",
      MOMENTUM_BREAKOUT_MIN_TP_PCT_AFTER_CAP: "0.0008",
      MOMENTUM_BREAKOUT_MIN_TP_ATR_AFTER_CAP: "0.30",
      IMPULSE_BASE_LOOKBACK: "10",
      IMPULSE_BASE_MAX_RANGE_ATR: "1.80",
      IMPULSE_BREAKOUT_BUFFER_ATR: "0.01",
      IMPULSE_BREAKDOWN_BUFFER_ATR: "0.01",
      IMPULSE_MIN_IMPULSE_BODY_ATR: "0.45",
      IMPULSE_VOL_MULT: "1.10",
      IMPULSE_MIN_ADX: "4",
      IMPULSE_SHORT_MIN_ADX: "4",
      IMPULSE_TP_ATR_MULT: "1.40",
      IMPULSE_SHORT_TP_ATR_MULT: "1.40",
      COMPRESSION_MIN_SCORE: "55",
      COMPRESSION_MIN_DROP_PCT: "0.003",
      COMPRESSION_MAX_BASE_ATR_MULT: "2.40",
      COMPRESSION_MIN_VOL_RATIO: "1.05",
      COMPRESSION_BREAKOUT_CLOSE_BUFFER_ATR: "0.01",
      COMPRESSION_SHORT_MIN_SCORE: "55",
      COMPRESSION_SHORT_MIN_RALLY_PCT: "0.003",
      COMPRESSION_SHORT_MAX_BASE_ATR_MULT: "2.40",
      COMPRESSION_SHORT_MIN_VOL_RATIO: "1.05",
      COMPRESSION_SHORT_BREAKDOWN_CLOSE_BUFFER_ATR: "0.01",
    },
  },
  {
    label: "1h_1d_equity_breakout",
    tf: "1h",
    htfTf: "1d",
    ltfLimit: 2200,
    htfLimit: 400,
    configOverrides: {
      DEFAULTS: {
        BREAKDOWN_RETEST_SHORT: {
          enabled: true,
          minScore: 56,
          minAdx: 4,
          maxAdx: 38,
          minBreakAtr: 0.04,
          maxRetestDistAtr: 0.5,
          minRejectBodyAtr: 0.05,
          requireRsiFalling: false,
          maxRsi: 64,
          requireVolume: false,
          minRelativeVolume: 0.9,
          tpAtrMult: 1.5,
          minRrAfterCap: 0.6,
          minTpPctAfterCap: 0.0007,
        },
        BULL_TRAP: {
          enabled: true,
          minScore: 56,
          minAdx: 4,
          maxAdx: 40,
          minBreakAtr: 0.03,
          minRejectionBodyAtr: 0.05,
          minUpperWickAtr: 0.07,
          minRsiFade: 0.2,
          maxRsiAfterReject: 68,
          requireVolume: false,
          minRelativeVolume: 0.9,
          tpAtrMult: 1.45,
          minRrAfterCap: 0.6,
          minTpPctAfterCap: 0.0007,
        },
      },
    },
    envOverrides: {
      MOMENTUM_BREAKOUT_LONG_ENABLED: "1",
      MOMENTUM_BREAKOUT_MIN_SCORE: "55",
      MOMENTUM_BREAKOUT_LOOKBACK_CANDLES: "8",
      MOMENTUM_BREAKOUT_MIN_ADX: "3",
      MOMENTUM_BREAKOUT_MAX_ADX: "32",
      MOMENTUM_BREAKOUT_MIN_BODY_ATR: "0.06",
      MOMENTUM_BREAKOUT_MIN_BREAKOUT_CLOSE_ATR: "0.015",
      MOMENTUM_BREAKOUT_MIN_BASE_TIGHTNESS_ATR: "0.15",
      MOMENTUM_BREAKOUT_MAX_BASE_RANGE_ATR: "1.20",
      MOMENTUM_BREAKOUT_MAX_BASE_DRIFT_ATR: "1.80",
      MOMENTUM_BREAKOUT_MAX_DIST_EMA20_ATR: "2.00",
      MOMENTUM_BREAKOUT_MIN_RELATIVE_VOLUME: "0.95",
      MOMENTUM_BREAKOUT_MIN_RSI: "49",
      MOMENTUM_BREAKOUT_MAX_RSI: "67",
      MOMENTUM_BREAKOUT_MIN_RSI_RECOVERY: "0.05",
      MOMENTUM_BREAKOUT_REQUIRE_ABOVE_EMA20: "1",
      MOMENTUM_BREAKOUT_REQUIRE_ABOVE_EMA50: "0",
      MOMENTUM_BREAKOUT_REQUIRE_BULLISH_FAST: "0",
      MOMENTUM_BREAKOUT_TP_ATR_MULT: "1.15",
      MOMENTUM_BREAKOUT_MIN_RR_AFTER_CAP: "0.55",
      MOMENTUM_BREAKOUT_MIN_TP_PCT_AFTER_CAP: "0.0007",
      MOMENTUM_BREAKOUT_MIN_TP_ATR_AFTER_CAP: "0.25",
      IMPULSE_BASE_LOOKBACK: "8",
      IMPULSE_BASE_MAX_RANGE_ATR: "2.00",
      IMPULSE_BREAKOUT_BUFFER_ATR: "0.005",
      IMPULSE_BREAKDOWN_BUFFER_ATR: "0.005",
      IMPULSE_MIN_IMPULSE_BODY_ATR: "0.35",
      IMPULSE_VOL_MULT: "1.05",
      IMPULSE_MIN_ADX: "3",
      IMPULSE_SHORT_MIN_ADX: "3",
      IMPULSE_TP_ATR_MULT: "1.25",
      IMPULSE_SHORT_TP_ATR_MULT: "1.25",
      COMPRESSION_MIN_SCORE: "52",
      COMPRESSION_MIN_DROP_PCT: "0.002",
      COMPRESSION_MAX_BASE_ATR_MULT: "2.60",
      COMPRESSION_MIN_VOL_RATIO: "1.00",
      COMPRESSION_BREAKOUT_CLOSE_BUFFER_ATR: "0.005",
      COMPRESSION_SHORT_MIN_SCORE: "52",
      COMPRESSION_SHORT_MIN_RALLY_PCT: "0.002",
      COMPRESSION_SHORT_MAX_BASE_ATR_MULT: "2.60",
      COMPRESSION_SHORT_MIN_VOL_RATIO: "1.00",
      COMPRESSION_SHORT_BREAKDOWN_CLOSE_BUFFER_ATR: "0.005",
    },
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scoreCandidate(summary) {
  const sampleGate = summary.trades >= 8 ? 1 : 0;
  const pnl = Number(summary.avgPnlPct || 0);
  const pf = Number(summary.profitFactor || 0);
  const winrate = Number(summary.winrate || 0);

  return [sampleGate, pnl, pf, winrate, Number(summary.trades || 0)];
}

function compareScores(a, b) {
  const sa = scoreCandidate(a);
  const sb = scoreCandidate(b);

  for (let i = 0; i < sa.length; i += 1) {
    if (sb[i] !== sa[i]) return sb[i] - sa[i];
  }

  return 0;
}

function gatherCandidates(runOutput) {
  const rows = [];

  for (const row of runOutput.ranked || []) {
    const strategy = row.strategy;
    for (const [symbol, bySymbol] of Object.entries(row.bySymbol || {})) {
      rows.push({
        symbol,
        strategy,
        summary: clone(bySymbol.summary || {}),
      });
    }
  }

  return rows;
}

function isStrongCandidate(candidate) {
  const summary = candidate?.summary || {};

  return (
    Number(summary.trades || 0) >= 5 &&
    Number(summary.avgPnlPct || 0) > 0 &&
    Number(summary.profitFactor || 0) > 1
  );
}

function pickBestCandidate(symbolCandidates) {
  const withTrades = symbolCandidates.filter((candidate) => Number(candidate.summary?.trades || 0) > 0);
  const strong = withTrades.filter(isStrongCandidate);

  if (strong.length > 0) return strong[0];
  return withTrades[0] || null;
}

function buildPresetMeta(enabledStrategies, best) {
  const profileKeys = [
    ...new Set(
      Object.values(enabledStrategies)
        .map((candidate) => `${candidate.profile.tf}/${candidate.profile.htfTf}`)
        .filter(Boolean)
    ),
  ];

  if (profileKeys.length === 1) {
    const [profile] = profileKeys;
    const [tf, htfTf] = profile.split("/");
    return {
      tf,
      htfTf,
      profileMode: "single",
      profiles: [{ tf, htfTf }],
    };
  }

  if (profileKeys.length > 1) {
    return {
      tf: null,
      htfTf: null,
      profileMode: "per-strategy",
      profiles: profileKeys.map((profile) => {
        const [tf, htfTf] = profile.split("/");
        return { tf, htfTf };
      }),
      defaultTf: best?.profile?.tf || null,
      defaultHtfTf: best?.profile?.htfTf || null,
    };
  }

  return {
    tf: best?.profile?.tf || null,
    htfTf: best?.profile?.htfTf || null,
    profileMode: best ? "fallback" : "none",
    profiles: best ? [{ tf: best.profile.tf, htfTf: best.profile.htfTf }] : [],
  };
}

function pickRecommendations(profileRuns) {
  const recommendations = {};

  for (const symbol of SYMBOLS) {
    const symbolCandidates = [];

    for (const run of profileRuns) {
      for (const candidate of gatherCandidates(run.output)) {
        if (candidate.symbol !== symbol) continue;
        symbolCandidates.push({
          ...candidate,
          profile: run.profile,
        });
      }
    }

    symbolCandidates.sort((a, b) => compareScores(a.summary, b.summary));

    const strong = symbolCandidates.filter(isStrongCandidate);
    const bestRaw =
      symbolCandidates.find((candidate) => Number(candidate.summary.trades || 0) > 0) || null;
    const best = pickBestCandidate(symbolCandidates);
    const enabledStrategies = {};

    for (const candidate of strong) {
      const key = STRATEGY_KEY_MAP[candidate.strategy];
      if (!key) continue;

      if (
        !enabledStrategies[key] ||
        compareScores(candidate.summary, enabledStrategies[key].summary) < 0
      ) {
        enabledStrategies[key] = candidate;
      }
    }

    const presetMeta = buildPresetMeta(enabledStrategies, best);

    recommendations[symbol] = {
      best,
      bestRaw,
      strong,
      preset: {
        tf: presetMeta.tf,
        htfTf: presetMeta.htfTf,
        profileMode: presetMeta.profileMode,
        profiles: presetMeta.profiles,
        defaultTf: presetMeta.defaultTf || null,
        defaultHtfTf: presetMeta.defaultHtfTf || null,
        strategies: Object.fromEntries(
          Object.entries(enabledStrategies).map(([key, candidate]) => [
            key,
            {
              enabled: true,
              sourceStrategy: candidate.strategy,
              tf: candidate.profile.tf,
              htfTf: candidate.profile.htfTf,
              trades: candidate.summary.trades,
              avgPnlPct: candidate.summary.avgPnlPct,
              profitFactor: candidate.summary.profitFactor,
              winrate: candidate.summary.winrate,
            },
          ])
        ),
      },
    };
  }

  return recommendations;
}

function printRecommendations(summary) {
  console.log("\n=== TRADFI PRESET ===");

  for (const symbol of SYMBOLS) {
    const row = summary.recommendations[symbol];
    const best = row?.best;
    const bestRaw = row?.bestRaw;
    const strongKeys = Object.keys(row?.preset?.strategies || {});

    if (!best) {
      console.log(`${symbol}: sem sinais/trades suficientes`);
      continue;
    }

    const rawSuffix =
      bestRaw && (bestRaw.strategy !== best.strategy || bestRaw.profile.tf !== best.profile.tf || bestRaw.profile.htfTf !== best.profile.htfTf)
        ? ` rawBest=${bestRaw.strategy}@${bestRaw.profile.tf}/${bestRaw.profile.htfTf}`
        : "";

    console.log(
      `${symbol}: best=${best.strategy} @ ${best.profile.tf}/${best.profile.htfTf} ` +
        `trades=${best.summary.trades} avgPnl=${Number(best.summary.avgPnlPct || 0).toFixed(4)}% ` +
        `pf=${Number(best.summary.profitFactor || 0).toFixed(3)} ` +
        `strong=${strongKeys.join(", ") || "none"}${rawSuffix}`
    );
  }
}

function buildPresetFile(summary) {
  const symbols = {};

  for (const symbol of SYMBOLS) {
    const row = summary.recommendations[symbol];

    if (!row?.best) {
      symbols[symbol] = {
        status: "no-signal",
      };
      continue;
    }

    symbols[symbol] = {
      tf: row.preset.tf,
      htfTf: row.preset.htfTf,
      profileMode: row.preset.profileMode,
      profiles: row.preset.profiles,
      defaultTf: row.preset.defaultTf,
      defaultHtfTf: row.preset.defaultHtfTf,
      strategies: row.preset.strategies,
    };
  }

  return {
    generatedAt: summary.generatedAt,
    symbols,
  };
}

function runProfile(profile) {
  console.log(`\n[PROFILE] ${profile.label}`);

  const env = {
    ...process.env,
    TF: profile.tf,
    HTF_TF: profile.htfTf,
    BACKTEST_LTF_LIMIT: String(profile.ltfLimit),
    BACKTEST_HTF_LIMIT: String(profile.htfLimit),
    BACKTEST_MIN_HTF_CANDLES: "12",
    TRADFI_SYMBOLS: SYMBOLS.join(","),
    BACKTEST_CONFIG_OVERRIDES: JSON.stringify(profile.configOverrides || {}),
    ...(profile.envOverrides || {}),
  };

  const result = spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Falha no profile ${profile.label}`);
  }

  const savedOutput = path.join(OUTPUT_DIR, `tradfi-${profile.label}.json`);
  fs.copyFileSync(LATEST_OUTPUT, savedOutput);

  return {
    profile,
    output: JSON.parse(fs.readFileSync(savedOutput, "utf8")),
    savedOutput,
  };
}

function main() {
  ensureDir(OUTPUT_DIR);

  const runs = PROFILES.map(runProfile);
  const summary = {
    generatedAt: new Date().toISOString(),
    symbols: SYMBOLS,
    profiles: runs.map((run) => ({
      ...run.profile,
      savedOutput: run.savedOutput,
    })),
    recommendations: pickRecommendations(runs),
  };

  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(PRESET_FILE, JSON.stringify(buildPresetFile(summary), null, 2), "utf8");
  printRecommendations(summary);
  console.log(`\nSaved: ${SUMMARY_FILE}`);
  console.log(`Saved: ${PRESET_FILE}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  scoreCandidate,
  compareScores,
  isStrongCandidate,
  pickBestCandidate,
  buildPresetMeta,
  pickRecommendations,
  buildPresetFile,
};
