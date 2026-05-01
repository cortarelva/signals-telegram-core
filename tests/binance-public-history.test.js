const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMonthlyArchiveUrl,
  buildDailyArchiveUrl,
  buildFullMonthSequence,
  buildCurrentMonthDailySequence,
  normalizeKlineCsvRow,
  parseKlineCsvText,
  mergeSortedUniqueKlines,
  sliceRows,
} = require("../research/binance-public-history");

test("buildMonthlyArchiveUrl builds futures UM monthly kline URL", () => {
  assert.equal(
    buildMonthlyArchiveUrl("btcusdc", "1h", 2026, 3),
    "https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDC/1h/BTCUSDC-1h-2026-03.zip"
  );
});

test("buildDailyArchiveUrl builds futures UM daily kline URL", () => {
  assert.equal(
    buildDailyArchiveUrl("BTCUSDC", "15m", 2026, 4, 29),
    "https://data.binance.vision/data/futures/um/daily/klines/BTCUSDC/15m/BTCUSDC-15m-2026-04-29.zip"
  );
});

test("buildFullMonthSequence returns full months before current month", () => {
  const sequence = buildFullMonthSequence({
    months: 3,
    endDate: new Date("2026-04-30T12:00:00Z"),
  });

  assert.deepEqual(
    sequence.map((item) => item.key),
    ["2026-01", "2026-02", "2026-03"]
  );
});

test("buildCurrentMonthDailySequence returns current month days through yesterday", () => {
  const sequence = buildCurrentMonthDailySequence({
    endDate: new Date("2026-04-05T12:00:00Z"),
  });

  assert.deepEqual(
    sequence.map((item) => item.key),
    ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"]
  );
});

test("normalizeKlineCsvRow and parseKlineCsvText map Binance kline format", () => {
  const row = normalizeKlineCsvRow([
    "1499040000000",
    "0.01634790",
    "0.80000000",
    "0.01575800",
    "0.01577100",
    "148976.11427815",
    "1499644799999",
  ]);

  assert.deepEqual(row, {
    openTime: 1499040000000,
    open: 0.0163479,
    high: 0.8,
    low: 0.015758,
    close: 0.015771,
    volume: 148976.11427815,
    closeTime: 1499644799999,
  });

  const parsed = parseKlineCsvText(
    "1499040000000,0.01634790,0.80000000,0.01575800,0.01577100,148976.11427815,1499644799999\n" +
      "1499644800000,0.01577100,0.02000000,0.01500000,0.01900000,100.0,1500249599999\n"
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].close, 0.019);
});

test("mergeSortedUniqueKlines de-duplicates by openTime and keeps ascending order", () => {
  const existing = [
    { openTime: 2, closeTime: 3, close: 20 },
    { openTime: 4, closeTime: 5, close: 40 },
  ];
  const incoming = [
    { openTime: 1, closeTime: 2, close: 10 },
    { openTime: 4, closeTime: 5, close: 41 },
  ];

  const merged = mergeSortedUniqueKlines(existing, incoming);
  assert.deepEqual(merged.map((row) => row.openTime), [1, 2, 4]);
  assert.equal(merged[2].close, 41);
});

test("sliceRows applies endTime and limit", () => {
  const rows = [
    { openTime: 1, closeTime: 10 },
    { openTime: 2, closeTime: 20 },
    { openTime: 3, closeTime: 30 },
    { openTime: 4, closeTime: 40 },
  ];

  assert.deepEqual(sliceRows(rows, { endTime: 30, limit: 2 }), [
    { openTime: 2, closeTime: 20 },
    { openTime: 3, closeTime: 30 },
  ]);
});
