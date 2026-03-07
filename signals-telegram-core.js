const signalObj = {
  symbol: SYMBOL,
  tf: TF,
  side,
  entry,
  sl,
  tp,
  ts: Date.now(),
  ema50,
  ema200,
  rsi,
  atr,
  prevRsi, // Novo
  distToEma50, // Novo
  bullish, // Novo
  nearEma50, // Novo
  rsiInBand, // Novo
  rsiRising, // Novo
  cooldownPassed: (Date.now() - (state.lastSignal[keyFor(SYMBOL, TF)]?.ts || 0)) / 60000 >= COOLDOWN_MINS, // Novo
  entryDiffPctFromLast: entryDiffPct, // Novo
  maxHighDuringTrade: null, // Novo
  minLowDuringTrade: null, // Novo
  barsOpen: 0, // Novo
  pnlPct: null, // Novo
  rrPlanned: Math.abs(tp - entry) / Math.abs(entry - sl), // Novo
  rrRealized: null // Novo
};

function updateTracker(state, { symbol, tf, candleHigh, candleLow, candleClose }) {

    if (!Array.isArray(state.openSignals) || state.openSignals.length === 0) return;

    const stillOpen = [];
    const closedNow = [];

    for (const s of state.openSignals) {

        // só track do mesmo symbol/tf
        if (s.symbol !== symbol || s.tf !== tf) {
            stillOpen.push(s);
            continue;
        }

        // atualizar métricas de tracking
        s.maxHighDuringTrade = Math.max(s.maxHighDuringTrade ?? s.entry, candleHigh);
        s.minLowDuringTrade = Math.min(s.minLowDuringTrade ?? s.entry, candleLow);
        s.barsOpen = (s.barsOpen ?? 0) + 1;

        let outcome = null;

        // simulação execução
        if (candleLow <= s.sl) outcome = "SL";
        else if (candleHigh >= s.tp) outcome = "TP";

        if (!outcome) {
            stillOpen.push(s);
            continue;
        }

        const exitPrice = outcome === "TP" ? s.tp : s.sl;

        s.closedTs = Date.now();
        s.outcome = outcome;
        s.exitRef = candleClose;

        // PnL real
        s.pnlPct = ((exitPrice - s.entry) / s.entry) * 100;

        // Risk reward realizado
        s.rrRealized = Math.abs(exitPrice - s.entry) / Math.abs(s.entry - s.sl);

        closedNow.push(s);
    }

    state.openSignals = stillOpen;

    if (!Array.isArray(state.closedSignals)) state.closedSignals = [];
    state.closedSignals.push(...closedNow);

    return closedNow;
}