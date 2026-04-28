const test = require("node:test");
const assert = require("node:assert/strict");

const {
  summarizeCandles,
  classifyDirection,
  timeframeToMinutes,
  deriveSummarizeOptions,
  buildBtcRegimeSnapshot,
} = require("../runtime/btc-regime-context");

function makeCandle(close, volume = 100) {
  return {
    open: close,
    high: close * 1.002,
    low: close * 0.998,
    close,
    volume,
  };
}

function buildSeries(start, step, count, volumeBase = 100) {
  return Array.from({ length: count }, (_, index) =>
    makeCandle(start + step * index, volumeBase + index)
  );
}

test("classifyDirection uses a small flat band", () => {
  assert.equal(classifyDirection(0.35), "up");
  assert.equal(classifyDirection(-0.35), "down");
  assert.equal(classifyDirection(0.05), "flat");
});

test("deriveSummarizeOptions scales lookbacks with timeframe", () => {
  assert.equal(timeframeToMinutes("5m"), 5);
  assert.equal(timeframeToMinutes("15m"), 15);
  assert.equal(timeframeToMinutes("1h"), 60);
  assert.equal(timeframeToMinutes("1d"), 1440);

  assert.deepEqual(deriveSummarizeOptions("5m"), {
    lookback1hBars: 12,
    lookback4hBars: 48,
  });
  assert.deepEqual(deriveSummarizeOptions("15m"), {
    lookback1hBars: 4,
    lookback4hBars: 16,
  });
  assert.deepEqual(deriveSummarizeOptions("1h"), {
    lookback1hBars: 1,
    lookback4hBars: 4,
  });
});

test("summarizeCandles derives returns, ema posture and range", () => {
  const candles = buildSeries(100, 0.2, 64);
  const summary = summarizeCandles(candles);

  assert.ok(summary);
  assert.equal(summary.aboveEma20, true);
  assert.equal(summary.aboveEma50, true);
  assert.ok(summary.return1hPct > 0);
  assert.ok(summary.return4hPct > 0);
  assert.ok(summary.range1hPct > 0);
});

test("buildBtcRegimeSnapshot identifies BTC-led selloff when alts follow lower", () => {
  const btc = buildSeries(100, -0.35, 64, 200);
  const ada = buildSeries(10, -0.05, 64);
  const link = buildSeries(20, -0.08, 64);
  const xrp = buildSeries(5, -0.02, 64);

  const snapshot = buildBtcRegimeSnapshot({
    candlesBySymbol: {
      BTCUSDC: btc,
      ADAUSDC: ada,
      LINKUSDC: link,
      XRPUSDC: xrp,
    },
  });

  assert.equal(snapshot.state, "risk_off_selloff");
  assert.equal(snapshot.btc.direction, "down");
  assert.ok(snapshot.alts.followRate >= 0.6);
  assert.ok(snapshot.alts.negativeBreadth >= 0.6);
});

test("buildBtcRegimeSnapshot identifies divergent rotation when BTC moves but alts do not follow", () => {
  const btc = buildSeries(100, 0.4, 64, 200);
  const ada = buildSeries(10, -0.01, 64);
  const link = buildSeries(20, 0.0, 64);
  const xrp = buildSeries(5, -0.01, 64);

  const snapshot = buildBtcRegimeSnapshot({
    candlesBySymbol: {
      BTCUSDC: btc,
      ADAUSDC: ada,
      LINKUSDC: link,
      XRPUSDC: xrp,
    },
  });

  assert.equal(snapshot.state, "divergent_rotation");
  assert.equal(snapshot.btc.direction, "up");
  assert.ok(snapshot.alts.followRate < 0.4);
});
