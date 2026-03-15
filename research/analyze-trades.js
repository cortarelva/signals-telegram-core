const fs = require("fs");

const state = JSON.parse(fs.readFileSync("state.json", "utf8"));
const trades = Array.isArray(state.closedSignals) ? state.closedSignals : [];

const regimeStats = {};
const symbolStats = {};
const adxBuckets = {
  "ADX < 10": { trades: 0, wins: 0, pnl: 0 },
  "10-20": { trades: 0, wins: 0, pnl: 0 },
  "20-30": { trades: 0, wins: 0, pnl: 0 },
  ">=30": { trades: 0, wins: 0, pnl: 0 }
};

const scoreBuckets = {
  "0-49": { trades: 0, wins: 0, pnl: 0 },
  "50-74": { trades: 0, wins: 0, pnl: 0 },
  "75-100": { trades: 0, wins: 0, pnl: 0 }
};

function getRegime(t) {
  if (t.isTrend) return "TREND";
  if (t.isRange) return "RANGE";
  return "NEUTRAL";
}

function register(stat, win, pnl) {
  stat.trades++;
  if (win) stat.wins++;
  stat.pnl += pnl;
}

for (const t of trades) {
  if (!t.outcome) continue;

  const win = t.outcome === "TP";
  const pnl = Number(t.pnlPct ?? 0);

  const regime = getRegime(t);
  const symbol = t.symbol || "UNKNOWN";

  if (!regimeStats[regime]) regimeStats[regime] = { trades: 0, wins: 0, pnl: 0 };
  if (!symbolStats[symbol]) symbolStats[symbol] = { trades: 0, wins: 0, pnl: 0 };

  register(regimeStats[regime], win, pnl);
  register(symbolStats[symbol], win, pnl);

  const adx = Number(t.adx ?? 0);

  if (adx < 10) register(adxBuckets["ADX < 10"], win, pnl);
  else if (adx < 20) register(adxBuckets["10-20"], win, pnl);
  else if (adx < 30) register(adxBuckets["20-30"], win, pnl);
  else register(adxBuckets[">=30"], win, pnl);

  const score = Number(t.score ?? 0);

  if (score < 50) register(scoreBuckets["0-49"], win, pnl);
  else if (score < 75) register(scoreBuckets["50-74"], win, pnl);
  else register(scoreBuckets["75-100"], win, pnl);
}

function printStats(title, stats) {
  console.log(`\n==== ${title} ====`);

  let hasData = false;

  for (const k in stats) {
    const s = stats[k];
    if (s.trades === 0) continue;

    hasData = true;
    const winrate = ((s.wins / s.trades) * 100).toFixed(2);
    const avgPnl = (s.pnl / s.trades).toFixed(3);

    console.log(
      `${k} | trades: ${s.trades} | winrate: ${winrate}% | avg pnl: ${avgPnl}%`
    );
  }

  if (!hasData) {
    console.log("Sem dados.");
  }
}

printStats("REGIME", regimeStats);
printStats("SYMBOL", symbolStats);
printStats("ADX BUCKETS", adxBuckets);
printStats("SCORE BUCKETS", scoreBuckets);