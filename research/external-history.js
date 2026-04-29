require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const { getBaseAsset, isTradFiSymbol } = require("../runtime/symbol-universe");

const TWELVE_DATA_API_BASE =
  process.env.TWELVE_DATA_API_BASE || "https://api.twelvedata.com";
const DEFAULT_PROVIDER = String(process.env.EXTERNAL_HISTORY_PROVIDER || "auto").toLowerCase();
const DEFAULT_TWELVE_MIN_INTERVAL_MS = Number(
  process.env.TWELVE_DATA_MIN_INTERVAL_MS || 3000
);
const DEFAULT_TWELVE_RATE_LIMIT_BACKOFF_MS = Number(
  process.env.TWELVE_DATA_RATE_LIMIT_BACKOFF_MS || 65000
);
const DEFAULT_TWELVE_DAILY_LIMIT_BACKOFF_MS = Number(
  process.env.TWELVE_DATA_DAILY_LIMIT_BACKOFF_MS || 6 * 60 * 60 * 1000
);
const EXTERNAL_HISTORY_CACHE_DIR =
  process.env.EXTERNAL_HISTORY_CACHE_DIR ||
  path.join(__dirname, "cache", "external-history");
const DEFAULT_MAP = {
  AAPLUSDT: "AAPL",
  AMZNUSDT: "AMZN",
  COINUSDT: "COIN",
  EWJUSDT: "EWJ",
  EWYUSDT: "EWY",
  MSTRUSDT: "MSTR",
  NATGASUSDT: "NATGAS",
  PLTRUSDT: "PLTR",
  QQQUSDT: "QQQ",
  SPYUSDT: "SPY",
  XAGUSDT: "XAG/USD",
  XAUUSDT: "XAU/USD",
};
const DEFAULT_EXCHANGE_MAP = {
  AAPLUSDT: "NASDAQ",
  AMZNUSDT: "NASDAQ",
  COINUSDT: "NASDAQ",
  EWJUSDT: "ARCA",
  EWYUSDT: "ARCA",
  MSTRUSDT: "NASDAQ",
  PLTRUSDT: "NASDAQ",
  QQQUSDT: "NASDAQ",
  SPYUSDT: "NYSE",
};
const TWELVE_INTERVALS = {
  "1m": {
    requestInterval: "1min",
    outputInterval: "1m",
    aggregate: false,
  },
  "5m": {
    requestInterval: "5min",
    outputInterval: "5m",
    aggregate: false,
  },
  "15m": {
    requestInterval: "15min",
    outputInterval: "15m",
    aggregate: false,
  },
  "30m": {
    requestInterval: "30min",
    outputInterval: "30m",
    aggregate: false,
  },
  "1h": {
    requestInterval: "1h",
    outputInterval: "1h",
    aggregate: false,
  },
  "4h": {
    requestInterval: "4h",
    outputInterval: "4h",
    aggregate: false,
  },
  "1d": {
    requestInterval: "1day",
    outputInterval: "1d",
    aggregate: false,
  },
};

let twelveDataRequestChain = Promise.resolve();
let twelveDataLastRequestAt = 0;
const externalHistoryCache = new Map();
const externalHistoryRetryState = new Map();

function parseJsonObject(raw) {
  if (!raw || typeof raw !== "string") return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeEpochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function parseUtcDateTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    return normalizeEpochMs(Number(text));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const ts = Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(ts) ? ts : null;
  }

  const iso = text.includes("T") ? text : text.replace(" ", "T");
  const withZone = /Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`;
  const ts = Date.parse(withZone);
  return Number.isFinite(ts) ? ts : null;
}

function intervalToMs(interval) {
  const text = String(interval || "").trim();
  const match = /^(\d+)([mhdw])$/i.exec(text);
  if (!match) return null;

  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs =
    unit === "m"
      ? 60 * 1000
      : unit === "h"
        ? 60 * 60 * 1000
        : unit === "d"
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;

  return count * unitMs;
}

function ensureExternalHistoryCacheDir() {
  fs.mkdirSync(EXTERNAL_HISTORY_CACHE_DIR, { recursive: true });
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildExternalHistoryCacheKey(providerName, symbol, interval, ticker = null) {
  return [
    safeSlug(providerName || "provider"),
    safeSlug(symbol || "symbol"),
    safeSlug(interval || "interval"),
    safeSlug(ticker || symbol || "ticker"),
  ].join("|");
}

function getExternalHistoryCacheFile(cacheKey) {
  ensureExternalHistoryCacheDir();
  return path.join(EXTERNAL_HISTORY_CACHE_DIR, `${safeSlug(cacheKey)}.json`);
}

function getExternalHistoryRetryFile(cacheKey) {
  ensureExternalHistoryCacheDir();
  return path.join(EXTERNAL_HISTORY_CACHE_DIR, `${safeSlug(cacheKey)}.retry.json`);
}

function writeExternalHistoryCache(cacheKey, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const payload = {
    updatedAt: Date.now(),
    rows,
  };

  externalHistoryCache.set(cacheKey, payload);
  fs.writeFileSync(getExternalHistoryCacheFile(cacheKey), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function readExternalHistoryCache(cacheKey) {
  if (externalHistoryCache.has(cacheKey)) {
    return externalHistoryCache.get(cacheKey);
  }

  const file = getExternalHistoryCacheFile(cacheKey);
  if (!fs.existsSync(file)) return null;

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0) {
      return null;
    }
    externalHistoryCache.set(cacheKey, payload);
    return payload;
  } catch {
    return null;
  }
}

function writeExternalHistoryRetryState(cacheKey, state) {
  if (!state || !Number.isFinite(Number(state.retryAt)) || Number(state.retryAt) <= 0) {
    return null;
  }

  const payload = {
    updatedAt: Date.now(),
    retryAt: Number(state.retryAt),
    reason: state.reason ? String(state.reason) : "",
  };

  externalHistoryRetryState.set(cacheKey, payload);
  fs.writeFileSync(getExternalHistoryRetryFile(cacheKey), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function readExternalHistoryRetryState(cacheKey) {
  if (externalHistoryRetryState.has(cacheKey)) {
    return externalHistoryRetryState.get(cacheKey);
  }

  const file = getExternalHistoryRetryFile(cacheKey);
  if (!fs.existsSync(file)) return null;

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload || !Number.isFinite(Number(payload.retryAt)) || Number(payload.retryAt) <= 0) {
      return null;
    }
    const normalized = {
      updatedAt: Number(payload.updatedAt || 0),
      retryAt: Number(payload.retryAt),
      reason: payload.reason ? String(payload.reason) : "",
    };
    externalHistoryRetryState.set(cacheKey, normalized);
    return normalized;
  } catch {
    return null;
  }
}

function clearExternalHistoryRetryState(cacheKey) {
  externalHistoryRetryState.delete(cacheKey);
  const file = getExternalHistoryRetryFile(cacheKey);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

function mergeExternalHistoryRows(existingRows = [], incomingRows = []) {
  const merged = new Map();

  for (const row of [...existingRows, ...incomingRows]) {
    const openTime = Number(row?.openTime || 0);
    if (!Number.isFinite(openTime) || openTime <= 0) continue;
    merged.set(openTime, {
      openTime,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || 0),
      closeTime: Number(row.closeTime || 0),
    });
  }

  return [...merged.values()].sort((a, b) => a.openTime - b.openTime);
}

function getCacheFreshUntilMs(rows, interval) {
  const intervalMs = intervalToMs(interval);
  if (!intervalMs || !Array.isArray(rows) || rows.length === 0) return 0;
  const latest = rows[rows.length - 1];
  const latestCloseTime = Number(latest?.closeTime || 0);
  if (!Number.isFinite(latestCloseTime) || latestCloseTime <= 0) return 0;
  return latestCloseTime + intervalMs;
}

function getCachedExternalHistoryRows(cacheKey, interval, total, options = {}) {
  const payload = readExternalHistoryCache(cacheKey);
  if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0) return null;

  const nowMs = Number(options.nowMs || Date.now());
  const allowStale = options.allowStale === true;
  const freshUntilMs = getCacheFreshUntilMs(payload.rows, interval);

  if (!allowStale && freshUntilMs > 0 && nowMs >= freshUntilMs) {
    return null;
  }

  const rows = payload.rows.slice(-Math.min(Number(total || payload.rows.length), payload.rows.length));
  return {
    rows,
    updatedAt: Number(payload.updatedAt || 0),
    freshUntilMs,
    stale: freshUntilMs > 0 ? nowMs >= freshUntilMs : false,
  };
}

function estimateExternalHistoryRefreshRows(existingRows, interval, total, options = {}) {
  if (!Array.isArray(existingRows) || existingRows.length === 0) {
    return Math.max(1, Number(total || 1));
  }

  const intervalMs = intervalToMs(interval);
  if (!intervalMs) return Math.max(1, Number(total || existingRows.length));

  const latest = existingRows[existingRows.length - 1];
  const latestCloseTime = Number(latest?.closeTime || 0);
  const nowMs = Number(options.nowMs || Date.now());
  const warmupBars = Math.max(2, Number(options.warmupBars || 4));
  const missingBars =
    Number.isFinite(latestCloseTime) && latestCloseTime > 0
      ? Math.max(0, Math.ceil((nowMs - latestCloseTime) / intervalMs))
      : 0;
  const missingWindowBars = Math.max(0, Number(total || 0) - existingRows.length);

  return Math.max(
    1,
    Math.min(
      Math.max(1, Number(total || existingRows.length)),
      missingBars + missingWindowBars + warmupBars
    )
  );
}

function pickTwelveDataSymbol(symbol, env = process.env) {
  const overrides = {
    ...DEFAULT_MAP,
    ...parseJsonObject(env.EXTERNAL_HISTORY_SYMBOL_MAP),
  };
  const upper = String(symbol || "").toUpperCase();

  if (overrides[upper]) return overrides[upper];

  const base = getBaseAsset(upper);
  if (!base) return null;
  if (base === "XAU" || base === "XAG") return `${base}/USD`;
  return base;
}

function pickTwelveDataExchange(symbol, env = process.env) {
  const overrides = parseJsonObject(env.EXTERNAL_HISTORY_EXCHANGE_MAP);
  const upper = String(symbol || "").toUpperCase();
  return overrides[upper] || DEFAULT_EXCHANGE_MAP[upper] || null;
}

function resolveTwelveDataInterval(interval) {
  return TWELVE_INTERVALS[String(interval || "").toLowerCase()] || null;
}

function aggregateCandlesToInterval(candles, targetInterval) {
  const intervalMs = intervalToMs(targetInterval);
  if (!intervalMs || !Array.isArray(candles) || !candles.length) return [];

  const sorted = [...candles].sort((a, b) => Number(a.openTime) - Number(b.openTime));
  const groups = new Map();

  for (const candle of sorted) {
    const openTime = Number(candle.openTime);
    if (!Number.isFinite(openTime)) continue;
    const bucket = Math.floor(openTime / intervalMs) * intervalMs;

    if (!groups.has(bucket)) {
      groups.set(bucket, {
        openTime: bucket,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume || 0),
        closeTime: Number(candle.closeTime || bucket + intervalMs - 1),
      });
      continue;
    }

    const current = groups.get(bucket);
    current.high = Math.max(Number(current.high), Number(candle.high));
    current.low = Math.min(Number(current.low), Number(candle.low));
    current.close = Number(candle.close);
    current.volume += Number(candle.volume || 0);
    current.closeTime = Number(candle.closeTime || current.closeTime);
  }

  return [...groups.values()].sort((a, b) => a.openTime - b.openTime);
}

function normalizeTwelveDataRow(row, interval) {
  const openTime = parseUtcDateTime(row?.datetime);
  const intervalMs = intervalToMs(interval) || intervalToMs("1d") || 0;

  if (!openTime) return null;

  return {
    openTime,
    open: Number(row?.open),
    high: Number(row?.high),
    low: Number(row?.low),
    close: Number(row?.close),
    volume: Number(row?.volume || 0),
    closeTime: openTime + intervalMs - 1,
  };
}

function formatTwelveDateTime(ts, interval) {
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;

  if (String(interval || "").toLowerCase() === "1day") {
    return date.toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 19);
}

function describeTwelveDataError(payload) {
  if (!payload || typeof payload !== "object") return "unknown_twelve_data_error";
  return payload.message || payload.code || payload.status || "unknown_twelve_data_error";
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTwelveDataMinIntervalMs(env = process.env) {
  const value = Number(env.TWELVE_DATA_MIN_INTERVAL_MS || DEFAULT_TWELVE_MIN_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TWELVE_MIN_INTERVAL_MS;
}

function getTwelveDataRateLimitBackoffMs(env = process.env) {
  const value = Number(
    env.TWELVE_DATA_RATE_LIMIT_BACKOFF_MS || DEFAULT_TWELVE_RATE_LIMIT_BACKOFF_MS
  );
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TWELVE_RATE_LIMIT_BACKOFF_MS;
}

function getTwelveDataDailyLimitBackoffMs(env = process.env) {
  const value = Number(
    env.TWELVE_DATA_DAILY_LIMIT_BACKOFF_MS || DEFAULT_TWELVE_DAILY_LIMIT_BACKOFF_MS
  );
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TWELVE_DAILY_LIMIT_BACKOFF_MS;
}

function isTwelveDataRateLimitPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const message = String(payload.message || "").toLowerCase();
  return Number(payload.code) === 429 || message.includes("run out of api credits");
}

function isTwelveDataDailyCreditPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const message = String(payload.message || "").toLowerCase();
  return message.includes("for the day") || message.includes("daily limits");
}

function getNextUtcMidnightMs(nowMs = Date.now()) {
  const now = new Date(nowMs);
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
}

function resolveTwelveDataRetryAtMs(payload, env = process.env, nowMs = Date.now()) {
  if (!isTwelveDataRateLimitPayload(payload)) return 0;

  if (isTwelveDataDailyCreditPayload(payload)) {
    return Math.max(
      getNextUtcMidnightMs(nowMs),
      nowMs + getTwelveDataDailyLimitBackoffMs(env)
    );
  }

  return nowMs + getTwelveDataRateLimitBackoffMs(env);
}

function runTwelveDataRateLimited(task, options = {}) {
  const env = options.env || process.env;
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || sleepMs;
  const minIntervalMs = getTwelveDataMinIntervalMs(env);

  const run = async () => {
    const waitMs =
      twelveDataLastRequestAt > 0
        ? Math.max(0, twelveDataLastRequestAt + minIntervalMs - now())
        : 0;
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    twelveDataLastRequestAt = now();
    return task();
  };

  const scheduled = twelveDataRequestChain.then(run, run);
  twelveDataRequestChain = scheduled.then(
    () => undefined,
    () => undefined
  );
  return scheduled;
}

function resetTwelveDataRateLimiter() {
  twelveDataRequestChain = Promise.resolve();
  twelveDataLastRequestAt = 0;
}

async function fetchTwelveDataBatch({
  ticker,
  interval,
  total,
  apiKey,
  exchange,
  httpGet = axios.get,
  endDate = null,
  env = process.env,
  sleep = sleepMs,
  now = () => Date.now(),
}) {
  const params = {
    symbol: ticker,
    interval,
    apikey: apiKey,
    order: "desc",
    outputsize: Math.max(1, Math.min(5000, total)),
    format: "JSON",
    adjust: "splits",
    timezone: "UTC",
  };

  if (exchange) params.exchange = exchange;
  if (endDate) params.end_date = endDate;

  const request = () =>
    httpGet(`${TWELVE_DATA_API_BASE}/time_series`, {
      params,
      timeout: 20000,
    });

  const parseResponse = (response) => {
    const payload = response.data;
    if (!payload || payload.status !== "ok" || !Array.isArray(payload.values)) {
      return { ok: false, payload };
    }
    return { ok: true, payload };
  };

  const firstResponse = await runTwelveDataRateLimited(request, { env, sleep, now });
  const firstParsed = parseResponse(firstResponse);
  if (firstParsed.ok) return firstParsed.payload.values;

  if (isTwelveDataRateLimitPayload(firstParsed.payload)) {
    if (isTwelveDataDailyCreditPayload(firstParsed.payload)) {
      const error = new Error(
        `twelvedata_request_failed:${describeTwelveDataError(firstParsed.payload)}`
      );
      error.payload = firstParsed.payload;
      throw error;
    }

    await sleep(getTwelveDataRateLimitBackoffMs(env));
    const retryResponse = await runTwelveDataRateLimited(request, { env, sleep, now });
    const retryParsed = parseResponse(retryResponse);
    if (retryParsed.ok) return retryParsed.payload.values;
    const error = new Error(
      `twelvedata_request_failed:${describeTwelveDataError(retryParsed.payload)}`
    );
    error.payload = retryParsed.payload;
    throw error;
  }

  const error = new Error(
    `twelvedata_request_failed:${describeTwelveDataError(firstParsed.payload)}`
  );
  error.payload = firstParsed.payload;
  throw error;
}

async function fetchKlinesFromTwelveData(symbol, interval, total, options = {}) {
  const env = options.env || process.env;
  const apiKey = env.TWELVE_DATA_API_KEY || env.TWELVEDATA_API_KEY || "";
  if (!apiKey) {
    throw new Error("TWELVE_DATA_API_KEY missing");
  }

  const ticker = pickTwelveDataSymbol(symbol, env);
  const exchange = pickTwelveDataExchange(symbol, env);
  const resolved = resolveTwelveDataInterval(interval);
  if (!ticker || !resolved) {
    throw new Error(`unsupported_twelvedata_symbol_or_interval:${symbol}:${interval}`);
  }

  const nowMs = Number(
    typeof options.now === "function" ? options.now() : options.nowMs || Date.now()
  );
  const cacheKey = buildExternalHistoryCacheKey("twelvedata", symbol, interval, ticker);
  const freshCache = getCachedExternalHistoryRows(
    cacheKey,
    resolved.outputInterval,
    total,
    { nowMs }
  );
  if (freshCache?.rows?.length) {
    return freshCache.rows;
  }
  const staleCache = getCachedExternalHistoryRows(
    cacheKey,
    resolved.outputInterval,
    total,
    { nowMs, allowStale: true }
  );

  const retryState = readExternalHistoryRetryState(cacheKey);
  if (retryState && retryState.retryAt > nowMs) {
    if (staleCache?.rows?.length) {
      return staleCache.rows;
    }

    throw new Error(
      `twelvedata_retry_cooldown:${new Date(retryState.retryAt).toISOString()}`
    );
  }
  if (retryState && retryState.retryAt <= nowMs) {
    clearExternalHistoryRetryState(cacheKey);
  }

  const rows = [];
  let endDate = null;
  let safety = 0;
  const pageSize = Math.max(1, Math.min(5000, total));

  try {
    if (staleCache?.rows?.length) {
      const refreshRows = estimateExternalHistoryRefreshRows(
        staleCache.rows,
        resolved.outputInterval,
        total,
        {
          nowMs,
          warmupBars: Number(env.EXTERNAL_HISTORY_REFRESH_WARMUP_BARS || 4),
        }
      );
      const batch = await fetchTwelveDataBatch({
        ticker,
        interval: resolved.requestInterval,
        total: refreshRows,
        apiKey,
        exchange,
        httpGet: options.httpGet,
        endDate: null,
        env,
        sleep: options.sleep,
        now: options.now,
      });
      const normalized = batch
        .map((row) => normalizeTwelveDataRow(row, resolved.outputInterval))
        .filter(Boolean)
        .sort((a, b) => a.openTime - b.openTime);

      rows.push(...mergeExternalHistoryRows(staleCache.rows, normalized));
    } else while (rows.length < total && safety < 20) {
      safety += 1;
      const batch = await fetchTwelveDataBatch({
        ticker,
        interval: resolved.requestInterval,
        total: pageSize,
        apiKey,
        exchange,
        httpGet: options.httpGet,
        endDate,
        env,
        sleep: options.sleep,
        now: options.now,
      });

      const normalized = batch
        .map((row) => normalizeTwelveDataRow(row, resolved.outputInterval))
        .filter(Boolean)
        .sort((a, b) => a.openTime - b.openTime);

      if (!normalized.length) break;

      if (!rows.length) {
        rows.push(...normalized);
      } else {
        const oldestKnown = rows[0].openTime;
        const deduped = normalized.filter((row) => row.openTime < oldestKnown);
        if (!deduped.length) break;
        rows.unshift(...deduped);
      }

      const oldest = rows[0];
      const intervalMs = intervalToMs(resolved.outputInterval) || 0;
      endDate = formatTwelveDateTime(oldest.openTime - intervalMs, resolved.requestInterval);
      if (!endDate || normalized.length < Math.max(25, Math.floor(pageSize / 4))) break;
    }
  } catch (error) {
    const retryAt = resolveTwelveDataRetryAtMs(error?.payload, env, nowMs);
    if (retryAt > 0) {
      writeExternalHistoryRetryState(cacheKey, {
        retryAt,
        reason: error.message,
      });
    }

    if (staleCache?.rows?.length) {
      return staleCache.rows;
    }

    throw error;
  }

  const finalRows = resolved.aggregate
    ? aggregateCandlesToInterval(rows, resolved.outputInterval)
    : rows;

  const outputRows = finalRows.slice(-total);
  if (outputRows.length) {
    writeExternalHistoryCache(cacheKey, finalRows);
    clearExternalHistoryRetryState(cacheKey);
  }
  return outputRows;
}

function resolveExternalHistoryProvider(symbol, interval, env = process.env) {
  const provider = String(env.EXTERNAL_HISTORY_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  const tradfiOnly = String(env.EXTERNAL_HISTORY_TRADFI_ONLY || "1") !== "0";
  const autoTradfi = String(env.EXTERNAL_HISTORY_AUTO_TRADFI || "1") !== "0";
  const hasTwelveToken = Boolean(env.TWELVE_DATA_API_KEY || env.TWELVEDATA_API_KEY);
  const externalSymbol = isTradFiSymbol(symbol);

  if (tradfiOnly && !externalSymbol) return null;

  const wantsTwelve =
    provider === "twelvedata" ||
    provider === "twelve_data" ||
    provider === "twelve-data" ||
    provider === "auto" ||
    (!provider && autoTradfi);

  if (!wantsTwelve || !hasTwelveToken) return null;

  const ticker = pickTwelveDataSymbol(symbol, env);
  const exchange = pickTwelveDataExchange(symbol, env);
  const resolvedInterval = resolveTwelveDataInterval(interval);
  if (!ticker || !resolvedInterval) return null;

  return {
    name: "twelvedata",
    ticker,
    exchange,
    requestInterval: resolvedInterval.requestInterval,
    outputInterval: resolvedInterval.outputInterval,
    aggregate: resolvedInterval.aggregate,
  };
}

async function fetchKlinesFromExternalProvider(provider, symbol, interval, total, options = {}) {
  if (!provider || provider.name === "binance") {
    throw new Error("fetchKlinesFromExternalProvider requires an external provider");
  }

  if (provider.name === "twelvedata") {
    return fetchKlinesFromTwelveData(symbol, interval, total, options);
  }

  throw new Error(`unsupported_external_provider:${provider.name}`);
}

module.exports = {
  DEFAULT_MAP,
  parseJsonObject,
  intervalToMs,
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
  mergeExternalHistoryRows,
  getCacheFreshUntilMs,
  getCachedExternalHistoryRows,
  estimateExternalHistoryRefreshRows,
  normalizeTwelveDataRow,
  getTwelveDataMinIntervalMs,
  getTwelveDataRateLimitBackoffMs,
  getTwelveDataDailyLimitBackoffMs,
  isTwelveDataRateLimitPayload,
  isTwelveDataDailyCreditPayload,
  getNextUtcMidnightMs,
  resolveTwelveDataRetryAtMs,
  runTwelveDataRateLimited,
  resetTwelveDataRateLimiter,
  resolveExternalHistoryProvider,
  fetchKlinesFromTwelveData,
  fetchKlinesFromExternalProvider,
};
