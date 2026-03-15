const fs = require('fs');

function loadData(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function analyzeTrades(data) {
    const totalTrades = data.length;
    const wins = data.filter(trade => trade.outcome === 'TP').length;
    const losses = data.filter(trade => trade.outcome === 'SL').length;

    const winRate = (wins / totalTrades) * 100;
    const grossProfit = data.filter(trade => trade.outcome === 'TP').reduce((acc, trade) => acc + (trade.tp - trade.entry), 0);
    const grossLoss = data.filter(trade => trade.outcome === 'SL').reduce((acc, trade) => acc + (trade.entry - trade.sl), 0);

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    return {
        totalTrades,
        wins,
        losses,
        winRate,
        grossProfit,
        grossLoss,
        profitFactor
    };
}

const trades = loadData('/Users/joel/Documents/CoddingStuff/signals-telegram-core/backtest-dataset.json');
const analysis = analyzeTrades(trades);

console.log('=== Análise das Trades ===');
console.log('Total de Trades:', analysis.totalTrades);
console.log('Wins:', analysis.wins);
console.log('Losses:', analysis.losses);
console.log('Win Rate:', analysis.winRate.toFixed(2) + '%');
console.log('Gross Profit:', analysis.grossProfit.toFixed(2));
console.log('Gross Loss:', analysis.grossLoss.toFixed(2));
console.log('Profit Factor:', analysis.profitFactor.toFixed(2));

// Optimized code
const totalPnL = trades.reduce((acc, trade) => acc + (trade.outcome === 'TP' ? trade.tp - trade.entry : trade.entry - trade.sl), 0);