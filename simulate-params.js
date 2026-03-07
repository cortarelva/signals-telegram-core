const fs = require('fs');
const stateFile = './state.json';

function simulateParams(state, slAtrMult, tpAtrMult) {
  const trades = state.closedSignals;
  trades.forEach(trade => {
    const newSl = trade.entry - (slAtrMult * trade.atr);
    const newTp = trade.entry + (tpAtrMult * trade.atr);
    const maxHigh = trade.maxHighDuringTrade;
    const minLow = trade.minLowDuringTrade;
    let result;

    if (maxHigh && newTp > maxHigh) {
      result = 'TP';
    } else if (minLow && newSl < minLow) {
      result = 'SL';
    } else {
      result = 'OPEN_OR_UNKNOWN';
    }

    console.log(`Trade: ${trade.symbol}, Result: ${result}, New SL: ${newSl.toFixed(2)}, New TP: ${newTp.toFixed(2)}`);
  });
}

const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
const slAtrMult = parseFloat(process.argv.includes('--slAtrMult') ? process.argv[process.argv.indexOf('--slAtrMult') + 1] : 1.2);
const tpAtrMult = parseFloat(process.argv.includes('--tpAtrMult') ? process.argv[process.argv.indexOf('--tpAtrMult') + 1] : 1.6);
simulateParams(state, slAtrMult, tpAtrMult);