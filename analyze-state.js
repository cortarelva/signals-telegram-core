const fs = require('fs');
const stateFile = './state.json';

function analyzeClosedSignals(state) {
  const trades = state.closedSignals;
  const totalTrades = trades.length;
  const tpCount = trades.filter(t => t.outcome === 'TP').length;
  const slCount = trades.filter(t => t.outcome === 'SL').length;
  const winRate = (tpCount / totalTrades) * 100;
  const avgRsi = trades.reduce((acc, t) => acc + t.rsi, 0) / totalTrades;
  const avgAtr = trades.reduce((acc, t) => acc + t.atr, 0) / totalTrades;
  const avgBarsOpen = trades.reduce((acc, t) => acc + (t.barsOpen || 0), 0) / totalTrades;
  const avgPnlPct = trades.reduce((acc, t) => acc + (t.pnlPct || 0), 0) / totalTrades;

  const grouped = trades.reduce((acc, t) => {
    const key = `${t.symbol}_${t.tf}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const rsiTP = trades.filter(t => t.outcome === 'TP').map(t => t.rsi);
  const avgRsiTP = rsiTP.reduce((acc, r) => acc + r, 0) / rsiTP.length;
  const rsiSL = trades.filter(t => t.outcome === 'SL').map(t => t.rsi);
  const avgRsiSL = rsiSL.reduce((acc, r) => acc + r, 0) / rsiSL.length;

  console.log(`Total Trades: ${totalTrades}`);
  console.log(`TP: ${tpCount}, SL: ${slCount}`);
  console.log(`Win Rate: ${winRate.toFixed(2)}%`);
  console.log(`Average RSI: ${avgRsi.toFixed(2)}`);
  console.log(`Average ATR: ${avgAtr.toFixed(2)}`);
  console.log(`Average Bars Open: ${avgBarsOpen.toFixed(2)}`);
  console.log(`Average PnL %: ${avgPnlPct.toFixed(2)}`);
  console.log(`RSI Average of TP: ${avgRsiTP.toFixed(2)}`);
  console.log(`RSI Average of SL: ${avgRsiSL.toFixed(2)}`);
}

const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
analyzeClosedSignals(state);