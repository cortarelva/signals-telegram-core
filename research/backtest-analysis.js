const fs = require('fs');

function loadData(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function analyzeTrades(data) {
    const wins = data.filter(trade => trade.outcome === 'TP').slice(-10);
    const losses = data.filter(trade => trade.outcome === 'SL').slice(-10);

    console.log('=== 10 Trades Vencedoras ===');
    wins.forEach(win => {
        console.log(`Symbol: ${win.symbol}, Entry: ${win.entry}, Outcome: ${win.outcome}, RSI: ${win.rsi}, ATR: ${win.atr}, Dist to EMA50: ${win.distToEma50}, Bullish: ${win.bullish}, Near EMA50: ${win.nearEma50}, RSI in Band: ${win.rsiInBand}, RSI Rising: ${win.rsiRising}, Bars Open: ${win.barsOpen}`);
    });

    console.log('\n=== 10 Trades Perdedoras ===');
    losses.forEach(loss => {
        console.log(`Symbol: ${loss.symbol}, Entry: ${loss.entry}, Outcome: ${loss.outcome}, RSI: ${loss.rsi}, ATR: ${loss.atr}, Dist to EMA50: ${loss.distToEma50}, Bullish: ${loss.bullish}, Near EMA50: ${loss.nearEma50}, RSI in Band: ${loss.rsiInBand}, RSI Rising: ${loss.rsiRising}, Bars Open: ${loss.barsOpen}`);
    });

    // Cálculo de médias
    const avgWins = calculateAverage(wins);
    const avgLosses = calculateAverage(losses);
    console.log('\n=== Comparação de Médias ===');
    console.log(`Average RSI for Wins: ${avgWins.rsi}, Average RSI for Losses: ${avgLosses.rsi}`);
    console.log(`Average ATR for Wins: ${avgWins.atr}, Average ATR for Losses: ${avgLosses.atr}`);
    console.log(`Average Dist to EMA50 for Wins: ${avgWins.distToEma50}, Average Dist to EMA50 for Losses: ${avgLosses.distToEma50}`);
    console.log(`Average Bars Open for Wins: ${avgWins.barsOpen}, Average Bars Open for Losses: ${avgLosses.barsOpen}`);

    const rsiDifference = Math.abs(avgWins.rsi - avgLosses.rsi);
    const atrDifference = Math.abs(avgWins.atr - avgLosses.atr);
    const distToEma50Difference = Math.abs(avgWins.distToEma50 - avgLosses.distToEma50);
    const barsOpenDifference = Math.abs(avgWins.barsOpen - avgLosses.barsOpen);

    console.log(`\nDiferença Quantitativa Relevante: `);
    console.log(`RSI Difference: ${rsiDifference}`);
    console.log(`ATR Difference: ${atrDifference}`);
    console.log(`Dist to EMA50 Difference: ${distToEma50Difference}`);
    console.log(`Bars Open Difference: ${barsOpenDifference}`);
}

function calculateAverage(trades) {
    return {
        rsi: trades.reduce((acc, trade) => acc + trade.rsi, 0) / trades.length,
        atr: trades.reduce((acc, trade) => acc + trade.atr, 0) / trades.length,
        distToEma50: trades.reduce((acc, trade) => acc + trade.distToEma50, 0) / trades.length,
        barsOpen: trades.reduce((acc, trade) => acc + trade.barsOpen, 0) / trades.length,
    };
}

const trades = loadData('/Users/joel/Documents/CoddingStuff/signals-telegram-core/backtest-dataset.json');
analyzeTrades(trades);