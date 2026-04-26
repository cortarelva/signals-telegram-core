require("dotenv").config();

const axios = require("axios");

const { getBaseAsset, isTradFiSymbol } = require("../runtime/symbol-universe");

const TWELVE_DATA_API_BASE =
  process.env.TWELVE_DATA_API_BASE || "https://api.twelvedata.com";
const DEFAULT_PROVIDER = String(process.env.EXTERNAL_HISTORY_PROVIDER || "auto").toLowerCase();
const DEFAULT_TWELVE_MIN_INTERVAL_MS = Number(
  process.env.TWELVE_DATA_MIN_INTERVAL_MS || 8000
);
const DEFAULT_TWELVE_RATE_LIMIT_BACKOFF_MS = Number(
  process.env.TWELVE_DATA_RATE_LIMIT_BACKOFF_MS || 65000
);
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

function isTwelveDataRateLimitPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const message = String(payload.message || "").toLowerCase();
  return Number(payload.code) === 429 || message.includes("run out of api credits");
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
    await sleep(getTwelveDataRateLimitBackoffMs(env));
    const retryResponse = await runTwelveDataRateLimited(request, { env, sleep, now });
    const retryParsed = parseResponse(retryResponse);
    if (retryParsed.ok) return retryParsed.payload.values;
    throw new Error(`twelvedata_request_failed:${describeTwelveDataError(retryParsed.payload)}`);
  }

  throw new Error(`twelvedata_request_failed:${describeTwelveDataError(firstParsed.payload)}`);
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

  const rows = [];
  let endDate = null;
  let safety = 0;
  const pageSize = Math.max(1, Math.min(5000, total));

  while (rows.length < total && safety < 20) {
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

  const finalRows = resolved.aggregate
    ? aggregateCandlesToInterval(rows, resolved.outputInterval)
    : rows;

  return finalRows.slice(-total);
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
  normalizeTwelveDataRow,
  getTwelveDataMinIntervalMs,
  getTwelveDataRateLimitBackoffMs,
  isTwelveDataRateLimitPayload,
  runTwelveDataRateLimited,
  resetTwelveDataRateLimiter,
  resolveExternalHistoryProvider,
  fetchKlinesFromTwelveData,
  fetchKlinesFromExternalProvider,
};
