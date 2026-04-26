const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(__dirname, "strategy-analysis.json");

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ficheiro não encontrado: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sortEntriesByAvgR(obj = {}, minTrades = 1) {
  return Object.entries(obj)
    .filter(([, v]) => Number(v?.resolved || 0) >= minTrades)
    .sort((a, b) => {
      const ar = Number(a[1]?.avgR || 0);
      const br = Number(b[1]?.avgR || 0);
      if (br !== ar) return br - ar;

      const aw = Number(a[1]?.winrate || 0);
      const bw = Number(b[1]?.winrate || 0);
      if (bw !== aw) return bw - aw;

      return Number(b[1]?.resolved || 0) - Number(a[1]?.resolved || 0);
    });
}

function printTop(title, obj, topN = 10, minTrades = 1) {
  const rows = sortEntriesByAvgR(obj, minTrades).slice(0, topN);

  console.log(`\n===== ${title} =====`);
  if (!rows.length) {
    console.log("Sem dados suficientes.");
    return;
  }

  for (const [key, v] of rows) {
    console.log(
      `${key} | trades=${v.trades} | resolved=${v.resolved} | winrate=${v.winrate.toFixed(2)}% | avgR=${v.avgR.toFixed(4)} | avgPnl=${v.avgPnlPct.toFixed(4)}`
    );
  }
}

function main() {
  const data = loadJson(INPUT_FILE);

  console.log("===== STRATEGY INSIGHTS =====");
  console.log(`Generated: ${data.generatedAt}`);
  console.log(`Resolved with strategy: ${data.resolvedWithStrategy}`);

  printTop("BY STRATEGY", data.byStrategy, 10, 1);
  printTop("BY SYMBOL", data.bySymbol, 20, 1);
  printTop("BY SYMBOL + STRATEGY", data.bySymbolStrategy, 20, 1);
  printTop("BY TF + STRATEGY", data.byTfStrategy, 20, 1);
  printTop("BY REGIME + STRATEGY", data.byRegimeStrategy, 20, 1);
  printTop("BY RSI BUCKET + STRATEGY", data.byRsiBucketStrategy, 20, 1);
  printTop("BY ADX BUCKET + STRATEGY", data.byAdxBucketStrategy, 20, 1);
  printTop("BY ATR% BUCKET + STRATEGY", data.byAtrPctBucketStrategy, 20, 1);
}

main();