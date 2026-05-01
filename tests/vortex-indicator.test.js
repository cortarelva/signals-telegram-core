const test = require("node:test");
const assert = require("node:assert/strict");

const { calcVortexSeries } = require("../indicators/market-indicators");

function buildBullishCandles() {
  return [
    { high: 10, low: 9, close: 9.5 },
    { high: 11, low: 9.7, close: 10.7 },
    { high: 12, low: 10.4, close: 11.8 },
    { high: 13, low: 11.4, close: 12.7 },
    { high: 14, low: 12.5, close: 13.8 },
  ];
}

test("calcVortexSeries returns padded series with directional values once enough context exists", () => {
  const series = calcVortexSeries(buildBullishCandles(), 3);

  assert.equal(series.length, 5);
  assert.equal(series[0], null);
  assert.equal(series[1], null);
  assert.equal(series[2], null);
  assert.equal(series[3]?.direction, "up");
  assert.equal(series[4]?.direction, "up");
  assert.ok(series[4].viPlus > series[4].viMinus);
  assert.ok(series[4].spread > 0);
});

test("calcVortexSeries returns empty array when there is not enough candle history", () => {
  assert.deepEqual(calcVortexSeries(buildBullishCandles().slice(0, 3), 4), []);
});
