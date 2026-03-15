const fs = require('fs');

function loadData(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function compareWinsLosses(data) {
    const wins = data.filter(trade => trade.outcome === 'TP');
    const losses = data.filter(trade => trade.outcome === 'SL');

    let comparisons = [];

    wins.forEach(win => {
        losses.forEach(loss => {
            comparisons.push({
                winEntry: win.entry,
                winTP: win.tp,
                lossEntry: loss.entry,
                lossSL: loss.sl,
                outcome: win.tp > loss.entry ? 'Win beats Loss' : 'Loss beats Win'
            });
        });
    });

    return comparisons;
}

const trades = loadData('/Users/joel/Documents/CoddingStuff/signals-telegram-core/backtest-dataset.json');
const result = compareWinsLosses(trades);

console.log('=== Comparação de Wins e Losses ===');
result.forEach(item => {
    console.log(`Win Entry: ${item.winEntry}, Win TP: ${item.winTP}, Loss Entry: ${item.lossEntry}, Loss SL: ${item.lossSL}, Outcome: ${item.outcome}`);
});