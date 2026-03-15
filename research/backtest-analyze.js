const fs = require('fs');

function loadData(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function analyzeTrades(data) {
    const wins = data.filter(trade => trade.outcome === 'TP');
    const losses = data.filter(trade => trade.outcome === 'SL');

    const winLossComparison = wins.map(win => {
        // Compare each winning trade with losses
        return losses.map(loss => ({
            winEntry: win.entry,
            winTP: win.tp,
            lossEntry: loss.entry,
            lossSL: loss.sl,
            outcome: win.tp > loss.entry ? 'Win beats Loss' : 'Loss beats Win'
        }));
    }).flat();

    return winLossComparison;
}

const trades = loadData('/Users/joel/Documents/CoddingStuff/signals-telegram-core/backtest-dataset.json');
const analysis = analyzeTrades(trades);

console.log('=== Comparação de Wins e Losses ===');
analysis.forEach(item => {
    console.log(`Win Entry: ${item.winEntry}, Win TP: ${item.winTP}, Loss Entry: ${item.lossEntry}, Loss SL: ${item.lossSL}, Outcome: ${item.outcome}`);
});