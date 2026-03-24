const fs = require("fs");
const path = require("path");

const STRATEGY_FILE = path.join(__dirname, "..", "strategy-config.json");
const ADAPTIVE_FILE = path.join(__dirname, "..", "runtime", "adaptive-config.json");

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function loadRuntimeConfig() {
  const base = loadJSON(STRATEGY_FILE);
  const adaptive = loadJSON(ADAPTIVE_FILE);

  const result = {};

  for (const symbol of Object.keys(base)) {
    const b = base[symbol] || {};
    const a = adaptive.symbols?.[symbol] || {};

    result[symbol] = {
      ...b,
      ENABLED: a.enabled ?? b.ENABLED,
      RSI_MIN: a.rsiMin ?? b.RSI_MIN,
      RSI_MAX: a.rsiMax ?? b.RSI_MAX,
      MIN_SCORE: a.minScore ?? 70,
      MIN_ADX: a.minAdx ?? 0,
      REQUIRE_TREND: a.requireTrend ?? false,
      REQUIRE_RANGE: a.requireRange ?? false,
      REQUIRE_NEAR_PULLBACK: a.requireNearPullback ?? false,
      REQUIRE_STACKED_EMA: a.requireStackedEma ?? false,
      REQUIRE_NEAR_EMA20: a.requireNearEma20 ?? false,
      REQUIRE_RSI_RISING: a.requireRsiRising ?? false,
    };
  }

  return result;
}

module.exports = { loadRuntimeConfig };