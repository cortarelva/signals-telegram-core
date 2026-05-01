const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LABELS,
  labelFutureDirection,
  buildFeatureRow,
  evaluateMulticlass,
  buildBaselineMomentum,
} = require("../research/predict-next-3-candles-direction");

function makeCandle(index, overrides = {}) {
  const base = 100 + index;
  return {
    openTime: index * 300000,
    open: base,
    high: base + 1,
    low: base - 1,
    close: base + 0.5,
    volume: 1000 + index * 10,
    closeTime: index * 300000 + 299999,
    ...overrides,
  };
}

test("labelFutureDirection classifies UP DOWN and FLAT with threshold band", () => {
  assert.deepEqual(
    labelFutureDirection({
      currentClose: 100,
      futureClose: 100.8,
      atrPct: 0.4,
      flatAtrMult: 0.5,
      minMovePct: 0.1,
    }),
    {
      label: "UP",
      thresholdPct: 0.2,
      futureDeltaPct: 0.8,
    }
  );

  assert.deepEqual(
    labelFutureDirection({
      currentClose: 100,
      futureClose: 99.1,
      atrPct: 0.4,
      flatAtrMult: 0.5,
      minMovePct: 0.1,
    }),
    {
      label: "DOWN",
      thresholdPct: 0.2,
      futureDeltaPct: -0.9,
    }
  );

  assert.deepEqual(
    labelFutureDirection({
      currentClose: 100,
      futureClose: 100.08,
      atrPct: 0.4,
      flatAtrMult: 0.5,
      minMovePct: 0.1,
    }),
    {
      label: "FLAT",
      thresholdPct: 0.2,
      futureDeltaPct: 0.08,
    }
  );
});

test("evaluateMulticlass reports accuracy and per-class confusion", () => {
  const metrics = evaluateMulticlass(
    [LABELS.indexOf("UP"), LABELS.indexOf("DOWN"), LABELS.indexOf("FLAT")],
    [LABELS.indexOf("UP"), LABELS.indexOf("FLAT"), LABELS.indexOf("FLAT")]
  );

  assert.equal(metrics.accuracy, 0.666667);
  assert.equal(metrics.confusion.UP.UP, 1);
  assert.equal(metrics.confusion.DOWN.FLAT, 1);
  assert.equal(metrics.perClass.FLAT.precision, 0.5);
});

test("buildBaselineMomentum follows the last candle direction or stays flat", () => {
  const rows = [
    { ret1Pct: 0.5, labelThresholdPct: 0.2 },
    { ret1Pct: -0.6, labelThresholdPct: 0.2 },
    { ret1Pct: 0.05, labelThresholdPct: 0.2 },
  ];

  assert.deepEqual(buildBaselineMomentum(rows), [
    LABELS.indexOf("UP"),
    LABELS.indexOf("DOWN"),
    LABELS.indexOf("FLAT"),
  ]);
});

test("buildFeatureRow emits a labeled research row once warmup is available", () => {
  const candles = Array.from({ length: 260 }, (_, index) =>
    makeCandle(index, {
      open: 100 + index * 0.1,
      high: 100.8 + index * 0.1,
      low: 99.4 + index * 0.1,
      close: 100.4 + index * 0.1,
      volume: 1000 + index * 5,
    })
  );
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const ema20 = closes.map((value) => value);
  const ema50 = closes.map((value) => value - 0.2);
  const ema200 = closes.map((value) => value - 0.5);
  const rsiSeries = Array.from({ length: closes.length - 14 }, () => 55);
  const macdSeries = closes.map(() => ({ hist: 0.01 }));

  const row = buildFeatureRow(
    {
      symbol: "ADAUSDC",
      tf: "5m",
      candles,
      closes,
      volumes,
      ema20,
      ema50,
      ema200,
      rsiSeries,
      macdSeries,
    },
    240
  );

  assert.equal(row.symbol, "ADAUSDC");
  assert.equal(row.tf, "5m");
  assert.match(row.signalIso, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(LABELS.includes(row.targetLabel));
  assert.equal(typeof row.compression5v20, "number");
  assert.equal(typeof row.c0_bodyPct, "number");
});
