const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  pickTwelveDataSymbol,
  pickTwelveDataExchange,
  resolveTwelveDataInterval,
  aggregateCandlesToInterval,
  buildExternalHistoryCacheKey,
  getExternalHistoryCacheFile,
  getExternalHistoryRetryFile,
  readExternalHistoryCache,
  writeExternalHistoryCache,
  readExternalHistoryRetryState,
  writeExternalHistoryRetryState,
  clearExternalHistoryRetryState,
  getCacheFreshUntilMs,
  getTwelveDataDailyLimitBackoffMs,
  getTwelveDataMinIntervalMs,
  isTwelveDataRateLimitPayload,
  isTwelveDataDailyCreditPayload,
  getNextUtcMidnightMs,
  resolveTwelveDataRetryAtMs,
  runTwelveDataRateLimited,
  resetTwelveDataRateLimiter,
  resolveExternalHistoryProvider,
  fetchKlinesFromTwelveData,
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

test("isTwelveDataDailyCreditPayload detects daily credit exhaustion", () => {
  assert.equal(
    isTwelveDataDailyCreditPayload({
      code: 429,
      message: "You have run out of API credits for the day. Upgrade your plan.",
    }),
    true
  );
  assert.equal(
    isTwelveDataDailyCreditPayload({
      code: 429,
      message: "You have run out of API credits for the current minute.",
    }),
    false
  );
});

test("resolveTwelveDataRetryAtMs backs daily exhaustion off until next UTC midnight", () => {
  const nowMs = Date.parse("2026-04-27T12:34:56.000Z");
  const nextUtcMidnightMs = Date.parse("2026-04-28T00:00:00.000Z");

  assert.equal(getNextUtcMidnightMs(nowMs), nextUtcMidnightMs);
  assert.equal(
    resolveTwelveDataRetryAtMs(
      {
        code: 429,
        message: "You have run out of API credits for the day. Upgrade your plan.",
      },
      {
        TWELVE_DATA_DAILY_LIMIT_BACKOFF_MS: String(60 * 60 * 1000),
      },
      nowMs
    ),
    nextUtcMidnightMs
  );
});

test("resolveTwelveDataRetryAtMs uses configured backoff for minute exhaustion", () => {
  const nowMs = Date.parse("2026-04-27T12:34:56.000Z");

  assert.equal(getTwelveDataDailyLimitBackoffMs({}), 6 * 60 * 60 * 1000);
  assert.equal(
    resolveTwelveDataRetryAtMs(
      {
        code: 429,
        message: "You have run out of API credits for the current minute.",
      },
      {
        TWELVE_DATA_RATE_LIMIT_BACKOFF_MS: "90000",
      },
      nowMs
    ),
    nowMs + 90000
  );
});

test("external history cache persists rows and reports freshness", () => {
  const cacheKey = buildExternalHistoryCacheKey(
    "twelvedata",
    "TESTUSDT",
    "1h",
    `TEST_${Date.now()}`
  );
  const cacheFile = getExternalHistoryCacheFile(cacheKey);
  const rows = [
    {
      openTime: Date.parse("2026-04-27T08:00:00.000Z"),
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
      closeTime: Date.parse("2026-04-27T08:59:59.999Z"),
    },
    {
      openTime: Date.parse("2026-04-27T09:00:00.000Z"),
      open: 1.5,
      high: 2.5,
      low: 1.4,
      close: 2.2,
      volume: 12,
      closeTime: Date.parse("2026-04-27T09:59:59.999Z"),
    },
  ];

  try {
    writeExternalHistoryCache(cacheKey, rows);
    const payload = readExternalHistoryCache(cacheKey);

    assert.ok(payload);
    assert.deepEqual(payload.rows, rows);
    assert.equal(
      getCacheFreshUntilMs(rows, "1h"),
      Date.parse("2026-04-27T10:59:59.999Z")
    );
  } finally {
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
  }
});

test("fetchKlinesFromTwelveData reuses stale cache during daily-credit exhaustion", async () => {
  resetTwelveDataRateLimiter();

  const symbol = `TST${Date.now()}USDT`;
  const ticker = symbol.replace(/USDT$/, "");
  const cacheKey = buildExternalHistoryCacheKey("twelvedata", symbol, "1h", ticker);
  const cacheFile = getExternalHistoryCacheFile(cacheKey);
  const retryFile = getExternalHistoryRetryFile(cacheKey);
  const rows = [
    {
      openTime: Date.parse("2026-04-27T08:00:00.000Z"),
      open: 1,
      high: 1.2,
      low: 0.9,
      close: 1.1,
      volume: 100,
      closeTime: Date.parse("2026-04-27T08:59:59.999Z"),
    },
    {
      openTime: Date.parse("2026-04-27T09:00:00.000Z"),
      open: 1.1,
      high: 1.3,
      low: 1.0,
      close: 1.25,
      volume: 110,
      closeTime: Date.parse("2026-04-27T09:59:59.999Z"),
    },
  ];

  let calls = 0;
  const httpGet = async () => {
    calls += 1;
    return {
      data: {
        status: "error",
        code: 429,
        message: "You have run out of API credits for the day. Upgrade your plan.",
      },
    };
  };

  try {
    writeExternalHistoryCache(cacheKey, rows);

    const first = await fetchKlinesFromTwelveData(symbol, "1h", 2, {
      env: {
        TWELVE_DATA_API_KEY: "token",
        TWELVE_DATA_MIN_INTERVAL_MS: "1",
      },
      httpGet,
      now: () => Date.parse("2026-04-27T12:00:00.000Z"),
      sleep: async () => {},
    });
    const second = await fetchKlinesFromTwelveData(symbol, "1h", 2, {
      env: {
        TWELVE_DATA_API_KEY: "token",
        TWELVE_DATA_MIN_INTERVAL_MS: "1",
      },
      httpGet,
      now: () => Date.parse("2026-04-27T12:05:00.000Z"),
      sleep: async () => {},
    });

    assert.deepEqual(first, rows);
    assert.deepEqual(second, rows);
    assert.equal(calls, 1);
  } finally {
    clearExternalHistoryRetryState(cacheKey);
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
    if (fs.existsSync(retryFile)) {
      fs.unlinkSync(retryFile);
    }
  }
});

test("persisted Twelve Data retry state survives process-like reuse and prevents repeat calls", async () => {
  resetTwelveDataRateLimiter();

  const symbol = `RST${Date.now()}USDT`;
  const ticker = symbol.replace(/USDT$/, "");
  const cacheKey = buildExternalHistoryCacheKey("twelvedata", symbol, "1h", ticker);
  const cacheFile = getExternalHistoryCacheFile(cacheKey);
  const retryFile = getExternalHistoryRetryFile(cacheKey);
  const rows = [
    {
      openTime: Date.parse("2026-04-27T08:00:00.000Z"),
      open: 1,
      high: 1.2,
      low: 0.9,
      close: 1.1,
      volume: 100,
      closeTime: Date.parse("2026-04-27T08:59:59.999Z"),
    },
    {
      openTime: Date.parse("2026-04-27T09:00:00.000Z"),
      open: 1.1,
      high: 1.3,
      low: 1.0,
      close: 1.25,
      volume: 110,
      closeTime: Date.parse("2026-04-27T09:59:59.999Z"),
    },
  ];
  let calls = 0;

  try {
    writeExternalHistoryCache(cacheKey, rows);
    writeExternalHistoryRetryState(cacheKey, {
      retryAt: Date.parse("2026-04-28T00:00:00.000Z"),
      reason: "twelvedata_request_failed:daily",
    });

    const retryState = readExternalHistoryRetryState(cacheKey);
    assert.ok(retryState);
    assert.equal(retryState.retryAt, Date.parse("2026-04-28T00:00:00.000Z"));

    const result = await fetchKlinesFromTwelveData(symbol, "1h", 2, {
      env: {
        TWELVE_DATA_API_KEY: "token",
        TWELVE_DATA_MIN_INTERVAL_MS: "1",
      },
      httpGet: async () => {
        calls += 1;
        return { data: { status: "ok", values: [] } };
      },
      now: () => Date.parse("2026-04-27T12:15:00.000Z"),
      sleep: async () => {},
    });

    assert.deepEqual(result, rows);
    assert.equal(calls, 0);
  } finally {
    clearExternalHistoryRetryState(cacheKey);
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
    if (fs.existsSync(retryFile)) {
      fs.unlinkSync(retryFile);
    }
  }
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
