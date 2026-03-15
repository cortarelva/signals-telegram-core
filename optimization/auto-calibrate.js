const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "state.json");
const BASE_CONFIG_FILE = path.join(__dirname, "strategy-config.json");
const GENERATED_CONFIG_FILE = path.join(__dirname, "strategy-config.generated.json");
const CONFIG_HISTORY_DIR = path.join(__dirname, "config-history");

const MIN_TRADES_PER_SYMBOL = 15;
const MIN_RESOLVED_TRADES = 8;

function loadJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function backupGeneratedConfig() {
  ensureDir(CONFIG_HISTORY_DIR);

  if (!fs.existsSync(GENERATED_CONFIG_FILE)) {
    console.log("ℹ️ strategy-config.generated.json ainda não existe. Sem backup para criar.");
    return null;
  }

  const backupName = `strategy-config.generated.${timestampForFile()}.json`;
  const backupPath = path.join(CONFIG_HISTORY_DIR, backupName);

  fs.copyFileSync(GENERATED_CONFIG_FILE, backupPath);
  console.log(`💾 Backup criado: ${backupPath}`);

  return backupPath;
}

function pct(n) {
  return `${n.toFixed(2)}%`;
}

function simulateTrade(trade, slAtrMult, tpAtrMult) {
  if (
    trade.maxHighDuringTrade == null ||
    trade.minLowDuringTrade == null ||
    trade.atr == null ||
    trade.entry == null
  ) {
    return "UNKNOWN";
  }

  const newSl = trade.entry - slAtrMult * trade.atr;
  const newTp = trade.entry + tpAtrMult * trade.atr;

  const hitTp = trade.maxHighDuringTrade >= newTp;
  const hitSl = trade.minLowDuringTrade <= newSl;

  if (hitTp && hitSl) return "AMBIGUOUS";
  if (hitTp) return "TP";
  if (hitSl) return "SL";
  return "OPEN_OR_UNKNOWN";
}

function runOptimization(trades) {
  const rsiMinValues = [35, 38, 40, 42];
  const rsiMaxValues = [48, 52, 55, 58, 62];
  const slValues = [1.5, 1.8, 2.0, 2.5];
  const tpValues = [1.5, 1.8, 2.0, 2.5, 3.0];
  const pullbackEma20Values = [0.6, 0.8, 1.0];
  const pullbackEma50Values = [1.0, 1.2, 1.5];
  const adxMinValues = [18, 20, 22, 25];
  const requireBullishFastValues = [false, true];
  const requireStackedEmaValues = [false, true];

  const results = [];

  for (const rsiMin of rsiMinValues) {
    for (const rsiMax of rsiMaxValues) {
      if (rsiMin >= rsiMax) continue;

      for (const slAtrMult of slValues) {
        for (const tpAtrMult of tpValues) {
          for (const pullbackEma20 of pullbackEma20Values) {
            for (const pullbackEma50 of pullbackEma50Values) {
              for (const adxMin of adxMinValues) {
                for (const requireBullishFast of requireBullishFastValues) {
                  for (const requireStackedEma of requireStackedEmaValues) {
                    const filtered = trades.filter((t) => {
                      if (typeof t.rsi !== "number") return false;
                      if (t.rsi < rsiMin || t.rsi > rsiMax) return false;

                      if (typeof t.adx !== "number" || t.adx < adxMin) return false;

                      const near20 =
                        typeof t.distToEma20 === "number" &&
                        typeof t.atr === "number" &&
                        t.distToEma20 <= pullbackEma20 * t.atr;

                      const near50 =
                        typeof t.distToEma50 === "number" &&
                        typeof t.atr === "number" &&
                        t.distToEma50 <= pullbackEma50 * t.atr;

                      if (!(near20 || near50)) return false;

                      if (requireBullishFast && t.bullishFast !== true) return false;

                      const stacked =
                        typeof t.ema20 === "number" &&
                        typeof t.ema50 === "number" &&
                        typeof t.ema200 === "number" &&
                        t.ema20 > t.ema50 &&
                        t.ema50 > t.ema200;

                      if (requireStackedEma && !stacked) return false;

                      return true;
                    });

                    if (!filtered.length) continue;

                    let tp = 0;
                    let sl = 0;
                    let ambiguous = 0;
                    let unknown = 0;

                    for (const trade of filtered) {
                      const outcome = simulateTrade(trade, slAtrMult, tpAtrMult);

                      if (outcome === "TP") tp++;
                      else if (outcome === "SL") sl++;
                      else if (outcome === "AMBIGUOUS") ambiguous++;
                      else unknown++;
                    }

                    const resolved = tp + sl;
                    if (resolved < MIN_RESOLVED_TRADES) continue;

                    const winRate = (tp / resolved) * 100;
                    const expectancy = (tp * tpAtrMult - sl * slAtrMult) / resolved;

                    results.push({
                      rsiMin,
                      rsiMax,
                      slAtrMult,
                      tpAtrMult,
                      pullbackEma20,
                      pullbackEma50,
                      adxMin,
                      requireBullishFast,
                      requireStackedEma,
                      trades: filtered.length,
                      resolved,
                      tp,
                      sl,
                      ambiguous,
                      unknown,
                      winRate,
                      expectancy,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  results.sort((a, b) => {
    if (b.expectancy !== a.expectancy) return b.expectancy - a.expectancy;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.resolved - a.resolved;
  });

  return results;
}

function main() {
  const state = loadJson(STATE_FILE, {});
  const baseConfig = loadJson(BASE_CONFIG_FILE, {});
  const existingGenerated = loadJson(GENERATED_CONFIG_FILE, {});

  const closedSignals = Array.isArray(state.closedSignals) ? state.closedSignals : [];

  if (!closedSignals.length) {
    console.log("Sem closedSignals para otimizar.");
    return;
  }

  const usableTrades = closedSignals.filter(
    (t) =>
      t.symbol &&
      t.maxHighDuringTrade != null &&
      t.minLowDuringTrade != null &&
      typeof t.rsi === "number" &&
      typeof t.atr === "number" &&
      typeof t.entry === "number" &&
      typeof t.distToEma20 === "number" &&
      typeof t.distToEma50 === "number" &&
      typeof t.adx === "number" &&
      typeof t.ema20 === "number" &&
      typeof t.ema50 === "number" &&
      typeof t.ema200 === "number"
  );

  if (!usableTrades.length) {
    console.log("Sem trades utilizáveis.");
    return;
  }

  const tradesBySymbol = {};
  for (const trade of usableTrades) {
    if (!tradesBySymbol[trade.symbol]) tradesBySymbol[trade.symbol] = [];
    tradesBySymbol[trade.symbol].push(trade);
  }

  const newGenerated = { ...existingGenerated };
  let hasChanges = false;

  console.log(`Total closed trades: ${closedSignals.length}`);
  console.log(`Usable trades: ${usableTrades.length}`);
  console.log("");

  for (const [symbol, trades] of Object.entries(tradesBySymbol)) {
    console.log(`===== ${symbol} =====`);
    console.log(`Trades utilizáveis: ${trades.length}`);

    if (trades.length < MIN_TRADES_PER_SYMBOL) {
      console.log(`Ignorado: menos de ${MIN_TRADES_PER_SYMBOL} trades.\n`);
      continue;
    }

    const results = runOptimization(trades);

    if (!results.length) {
      console.log("Sem combinações utilizáveis.\n");
      continue;
    }

    const best = results[0];

    console.log(
      `Melhor: RSI=[${best.rsiMin}, ${best.rsiMax}] ` +
      `SL=${best.slAtrMult} TP=${best.tpAtrMult} ` +
      `EMA20_ATR=${best.pullbackEma20} EMA50_ATR=${best.pullbackEma50} ` +
      `ADX_MIN=${best.adxMin} bullishFast=${best.requireBullishFast} stacked=${best.requireStackedEma}`
    );
    console.log(
      `resolved=${best.resolved} TP=${best.tp} SL=${best.sl} ` +
      `winRate=${pct(best.winRate)} expectancy=${best.expectancy.toFixed(4)}`
    );
    console.log("");

    const nextConfig = {
      ...(existingGenerated[symbol] || {}),
      RSI_MIN: best.rsiMin,
      RSI_MAX: best.rsiMax,
      SL_ATR_MULT: best.slAtrMult,
      TP_ATR_MULT: best.tpAtrMult,
      PULLBACK_EMA20_ATR: best.pullbackEma20,
      PULLBACK_EMA50_ATR: best.pullbackEma50,
      ADX_MIN_TREND: best.adxMin,
      REQUIRE_BULLISH_FAST: best.requireBullishFast,
      REQUIRE_STACKED_EMA: best.requireStackedEma,
      ENABLED: baseConfig[symbol]?.ENABLED ?? true,
      _auto: {
        updatedAt: new Date().toISOString(),
        sourceTrades: trades.length,
        resolvedTrades: best.resolved,
        winRate: Number(best.winRate.toFixed(2)),
        expectancy: Number(best.expectancy.toFixed(4)),
      },
    };

    const prevConfig = JSON.stringify(existingGenerated[symbol] || {});
    const newConfigStr = JSON.stringify(nextConfig);

    if (prevConfig !== newConfigStr) {
      hasChanges = true;
    }

    newGenerated[symbol] = nextConfig;
  }

  if (!hasChanges) {
    console.log("Sem alterações na config gerada. Não foi necessário criar backup nem gravar.");
    return;
  }

  backupGeneratedConfig();
  saveJson(GENERATED_CONFIG_FILE, newGenerated);

  console.log(`✅ Ficheiro atualizado: ${GENERATED_CONFIG_FILE}`);
}

main();