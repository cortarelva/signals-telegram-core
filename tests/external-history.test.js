const test = require("node:test");
const assert = require("node:assert/strict");

const {
  pickTwelveDataSymbol,
  pickTwelveDataExchange,
  resolveTwelveDataInterval,
  aggregateCandlesToInterval,
  getTwelveDataMinIntervalMs,
  isTwelveDataRateLimitPayload,
  runTwelveDataRateLimited,
  resetTwelveDataRateLimiter,
  resolveExternalHistoryProvider,
} = require("../research/external-history");

test("pickTwelveDataSymbol maps tradfi perps to Twelve Data symbols", () => {
  assert.equal(pickTwelveDataSymbol("AAPLUSDT"), "AAPL");
  assert.equal(pickTwelveDataSymbol("QQQUSDT"), "QQQ");
  assert.equal(pickTwelveDataSymbol("XAUUSDT"), "XAU/USD");
});

test("pickTwelveDataSymbol respects explicit env overrides", () => {
  assert.equal(
    pickTwelveDataSymbol("AAPLUSDT", {
      EXTERNAL_HISTORY_SYMBOL_MAP: JSON.stringify({ AAPLUSDT: "AAPL.CUSTOM" }),
    }),
    "AAPL.CUSTOM"
  );
});

test("pickTwelveDataExchange uses explicit exchange mapping when present", () => {
  assert.equal(pickTwelveDataExchange("AAPLUSDT"), "NASDAQ");
  assert.equal(
    pickTwelveDataExchange("SPYUSDT", {
      EXTERNAL_HISTORY_EXCHANGE_MAP: JSON.stringify({ SPYUSDT: "BATS" }),
    }),
    "BATS"
  );
});

test("resolveTwelveDataInterval maps bot timeframes to supported API intervals", () => {
  assert.deepEqual(resolveTwelveDataInterval("30m"), {
    requestInterval: "30min",
    outputInterval: "30m",
    aggregate: false,
  });

  assert.deepEqual(resolveTwelveDataInterval("4h"), {
    requestInterval: "4h",
    outputInterval: "4h",
    aggregate: false,
  });

  assert.deepEqual(resolveTwelveDataInterval("1d"), {
    requestInterval: "1day",
    outputInterval: "1d",
    aggregate: false,
  });
});

test("aggregateCandlesToInterval preserves OHLCV across merged buckets", () => {
  const candles = [
    { openTime: 0, open: 10, high: 11, low: 9.5, close: 10.5, volume: 100, closeTime: 299999 },
    { openTime: 300000, open: 10.5, high: 12, low: 10.4, close: 11.8, volume: 120, closeTime: 599999 },
    { openTime: 600000, open: 11.8, high: 12.2, low: 11.6, close: 12.0, volume: 80, closeTime: 899999 },
    { openTime: 900000, open: 12.0, high: 12.4, low: 11.7, close: 11.9, volume: 90, closeTime: 1199999 },
  ];

  const grouped = aggregateCandlesToInterval(candles, "15m");

  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0], {
    openTime: 0,
    open: 10,
    high: 12.2,
    low: 9.5,
    close: 12.0,
    volume: 300,
    closeTime: 899999,
  });
  assert.deepEqual(grouped[1], {
    openTime: 900000,
    open: 12.0,
    high: 12.4,
    low: 11.7,
    close: 11.9,
    volume: 90,
    closeTime: 1199999,
  });
});

test("resolveExternalHistoryProvider only activates for tradfi symbols with Twelve Data key", () => {
  assert.equal(
    resolveExternalHistoryProvider("ETHUSDC", "5m", {
      EXTERNAL_HISTORY_PROVIDER: "twelvedata",
      TWELVE_DATA_API_KEY: "token",
    }),
    null
  );

  assert.deepEqual(
    resolveExternalHistoryProvider("AAPLUSDT", "30m", {
      EXTERNAL_HISTORY_PROVIDER: "auto",
      TWELVE_DATA_API_KEY: "token",
    }),
    {
      name: "twelvedata",
      ticker: "AAPL",
      exchange: "NASDAQ",
      requestInterval: "30min",
      outputInterval: "30m",
      aggregate: false,
    }
  );
});

test("resolveExternalHistoryProvider no longer auto-activates EODHD", () => {
  assert.equal(
    resolveExternalHistoryProvider("AAPLUSDT", "30m", {
      EXTERNAL_HISTORY_PROVIDER: "auto",
      EODHD_API_TOKEN: "token",
    }),
    null
  );
});

test("getTwelveDataMinIntervalMs defaults to an 8 second spacing", () => {
  assert.equal(getTwelveDataMinIntervalMs({}), 8000);
  assert.equal(getTwelveDataMinIntervalMs({ TWELVE_DATA_MIN_INTERVAL_MS: "12000" }), 12000);
});

test("isTwelveDataRateLimitPayload detects Twelve Data minute-credit errors", () => {
  assert.equal(
    isTwelveDataRateLimitPayload({
      code: 429,
      message: "You have run out of API credits for the current minute.",
    }),
    true
  );
  assert.equal(
    isTwelveDataRateLimitPayload({
      code: 404,
      message: "symbol is missing",
    }),
    false
  );
});

test("runTwelveDataRateLimited serializes requests with spacing", async () => {
  resetTwelveDataRateLimiter();

  let currentNow = 1000;
  const waits = [];
  const calls = [];

  const now = () => currentNow;
  const sleep = async (ms) => {
    waits.push(ms);
    currentNow += ms;
  };

  const first = runTwelveDataRateLimited(
    async () => {
      calls.push(currentNow);
      return "first";
    },
    { env: { TWELVE_DATA_MIN_INTERVAL_MS: "8000" }, now, sleep }
  );

  const second = runTwelveDataRateLimited(
    async () => {
      calls.push(currentNow);
      return "second";
    },
    { env: { TWELVE_DATA_MIN_INTERVAL_MS: "8000" }, now, sleep }
  );

  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(waits, [8000]);
  assert.deepEqual(calls, [1000, 9000]);
});
