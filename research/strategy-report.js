const fs = require("fs");

function loadState(path = "./state.json") {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function pct(v) {
  return `${v.toFixed(2)}%`;
}

function safeNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function main() {
  const state = loadState();
  const trades = state.closedSignals || [];

  if (!trades.length) {
    console.log("Sem trades fechadas.");
    return;
  }

  const wins = trades.filter((t) => t.outcome === "TP");
  const losses = trades.filter((t) => t.outcome === "SL");

  const pnlTrades = trades.filter((t) => safeNum(t.pnlPct)).map((t) => t.pnlPct);
  const positivePnL = pnlTrades.filter((v) => v > 0);
  const negativePnLAbs = pnlTrades.filter((v) => v < 0).map(Math.abs);

  const totalTrades = trades.length;
  const winrate = (wins.length / totalTrades) * 100;
  const avgTrade = avg(pnlTrades);
  const grossProfit = sum(positivePnL);
  const grossLoss = sum(negativePnLAbs);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const t of trades) {
    const pnl = safeNum(t.pnlPct) ? t.pnlPct : 0;
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  console.log("=== STRATEGY REPORT ===");
  console.log("Total trades:", totalTrades);
  console.log("TP:", wins.length);
  console.log("SL:", losses.length);
  console.log("Winrate:", pct(winrate));
  console.log("Average trade:", pct(avgTrade));
  console.log("Gross profit:", grossProfit.toFixed(2));
  console.log("Gross loss:", grossLoss.toFixed(2));
  console.log(
    "Profit factor:",
    Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "Infinity"
  );
  console.log("Max drawdown (approx % points):", maxDrawdown.toFixed(2));

  const bySymbol = {};
  for (const t of trades) {
    const key = `${t.symbol}_${t.tf}`;
    if (!bySymbol[key]) bySymbol[key] = [];
    bySymbol[key].push(t);
  }

  console.log("\n=== BY SYMBOL / TF ===");
  for (const [key, arr] of Object.entries(bySymbol)) {
    const w = arr.filter((t) => t.outcome === "TP").length;
    const wr = (w / arr.length) * 100;
    console.log(`${key}: trades=${arr.length}, winrate=${pct(wr)}`);
  }
}

main();