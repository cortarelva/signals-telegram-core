require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Binance = require("node-binance-api");
const { canExecute } = require("./risk-manager");
const { appendJsonArray } = require("./file-utils");

// =========================
// Config
// =========================

const EXECUTION_MODE = String(process.env.EXECUTION_MODE || "paper").toLowerCase();

const FUTURES_FOLLOW_SIGNAL_DIRECTION =
  String(process.env.FUTURES_FOLLOW_SIGNAL_DIRECTION || "1") === "1";

const FUTURES_DEFAULT_LEVERAGE = Number(process.env.FUTURES_DEFAULT_LEVERAGE || 3);
const FUTURES_MARGIN_TYPE = String(process.env.FUTURES_MARGIN_TYPE || "ISOLATED").toUpperCase();
const FUTURES_POSITION_MODE = String(process.env.FUTURES_POSITION_MODE || "ONE_WAY").toUpperCase();

const FUTURES_ATTACH_TPSL_ON_ENTRY = String(process.env.FUTURES_ATTACH_TPSL_ON_ENTRY || "0") === "1";
const FUTURES_TPSL_WORKING_TYPE = String(process.env.FUTURES_TPSL_WORKING_TYPE || "CONTRACT_PRICE");
const FUTURES_TPSL_PRICE_PROTECT = String(process.env.FUTURES_TPSL_PRICE_PROTECT || "1") === "1";
const BREAK_EVEN_ENABLED = Number(process.env.BREAK_EVEN_ENABLED || 0) === 1;


const FUTURES_RISK_PER_TRADE = Number(process.env.FUTURES_RISK_PER_TRADE || 0.005);
const FUTURES_MAX_OPEN_POSITIONS = Number(process.env.FUTURES_MAX_OPEN_POSITIONS || 3);
const FUTURES_MAX_OPEN_PER_SYMBOL = Number(process.env.FUTURES_MAX_OPEN_PER_SYMBOL || 1);

const FUTURES_ALLOW_LONG = String(process.env.FUTURES_ALLOW_LONG || "1") === "1";
const FUTURES_ALLOW_SHORT = String(process.env.FUTURES_ALLOW_SHORT || "1") === "1";

const FUTURES_MIN_NOTIONAL_USDT = Number(process.env.FUTURES_MIN_NOTIONAL_USDT || 5);
const FUTURES_BALANCE_BUFFER_PCT = Number(process.env.FUTURES_BALANCE_BUFFER_PCT || 0.90);
const FUTURES_MAX_POSITION_USDT = Number(process.env.FUTURES_MAX_POSITION_USDT || 40);
const ACCOUNT_SIZE = Number(process.env.ACCOUNT_SIZE || 1000);
const FUTURES_ACCOUNT_SIZE_MODE = String(
  process.env.FUTURES_ACCOUNT_SIZE_MODE || "auto"
)
  .trim()
  .toLowerCase();
const BINANCE_RECV_WINDOW = Number(process.env.BINANCE_RECV_WINDOW || 5000);

const ORDERS_LOG_FILE =
  process.env.ORDERS_LOG_FILE_PATH || path.join(__dirname, "orders-log.json");

const FUTURES_SET_MARGIN_TYPE = String(process.env.FUTURES_SET_MARGIN_TYPE || "0") === "1";
const ENABLE_TELEGRAM = String(process.env.ENABLE_TELEGRAM || "0") === "1";
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "");
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "");
const futuresFiltersCache = new Map();

function hasRealTradeProtectionPathEnabled() {
  return FUTURES_ATTACH_TPSL_ON_ENTRY || BREAK_EVEN_ENABLED;
}

function decimalsFromStep(step) {
  const stepStr = String(step || "1");
  if (!stepStr.includes(".")) return 0;
  return stepStr.replace(/0+$/, "").split(".")[1]?.length || 0;
}

function floorToStep(value, step) {
  const n = Number(value);
  const s = Number(step);
  if (!Number.isFinite(n) || !Number.isFinite(s) || s <= 0) return 0;

  const decimals = decimalsFromStep(step);
  const floored = Math.floor((n + Number.EPSILON) / s) * s;
  return Number(floored.toFixed(decimals));
}

async function initFuturesFilters(symbol) {
  if (futuresFiltersCache.has(symbol)) return futuresFiltersCache.get(symbol);

  const info = await binance.futuresExchangeInfo();
  const sym = Array.isArray(info?.symbols)
    ? info.symbols.find((s) => s.symbol === symbol)
    : null;

  if (!sym) {
    throw new Error(`Símbolo ${symbol} não encontrado em futuresExchangeInfo`);
  }

  let lot = sym.filters?.find((f) => f.filterType === "MARKET_LOT_SIZE");
  if (!lot || Number(lot.stepSize) <= 0) {
    lot = sym.filters?.find((f) => f.filterType === "LOT_SIZE");
  }

  if (!lot) {
    throw new Error(`MARKET_LOT_SIZE/LOT_SIZE ausente para ${symbol}`);
  }

  const minNotionalFilter = sym.filters?.find((f) => f.filterType === "MIN_NOTIONAL");

  const filters = {
    stepSize: Number(lot.stepSize),
    minQty: Number(lot.minQty || 0),
    maxQty: Number(lot.maxQty || 0),
    minNotional: Number(minNotionalFilter?.notional || minNotionalFilter?.minNotional || 0),
    quantityPrecision: Number(sym.quantityPrecision ?? decimalsFromStep(lot.stepSize)),
  };

  futuresFiltersCache.set(symbol, filters);
  return filters;
}

function adjustFuturesQty(qty, filters, refPrice = 0) {
  let safeQty = floorToStep(qty, filters.stepSize);

  if (safeQty < filters.minQty) {
    safeQty = Number(filters.minQty);
  }

  if (filters.maxQty > 0 && safeQty > filters.maxQty) {
    safeQty = floorToStep(filters.maxQty, filters.stepSize);
  }

  if (
    filters.minNotional > 0 &&
    Number(refPrice) > 0 &&
    safeQty * Number(refPrice) < filters.minNotional
  ) {
    const rawQty = filters.minNotional / Number(refPrice);
    const steps = Math.ceil((rawQty - Number(filters.minQty || 0)) / filters.stepSize);
    safeQty = Number(filters.minQty || 0) + Math.max(0, steps) * filters.stepSize;
    safeQty = Number(safeQty.toFixed(filters.quantityPrecision));
  }

  return Number(safeQty.toFixed(filters.quantityPrecision));
}

// =========================
// Binance client
// =========================

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  recvWindow: BINANCE_RECV_WINDOW,
  useServerTime: true,
  test: false,
});

// =========================
// Utils
// =========================

function round(n, d = 8) {
  if (!Number.isFinite(Number(n))) return 0;
  return Number(Number(n).toFixed(d));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasFiniteNumberValue(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function safeRatio(a, b) {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b)) || Number(b) === 0) {
    return null;
  }
  return Number(a) / Number(b);
}

function appendOrderLog(entry) {
  try {
    appendJsonArray(ORDERS_LOG_FILE, entry);
  } catch (err) {
    console.error("[FUTURES_EXECUTOR] erro ao gravar orders-log:", err.message);
  }
}

function countOpenPositions(state, symbol = null) {
  const executions = Array.isArray(state.executions) ? state.executions : [];
  return executions.filter((e) => {
    if (e.status !== "OPEN") return false;
    if (symbol && e.symbol !== symbol) return false;
    return true;
  }).length;
}

function getOpenOrderSide(direction) {
  if (direction === "LONG") return "BUY";
  if (direction === "SHORT") return "SELL";
  throw new Error(`Direção inválida: ${direction}`);
}

function getCloseOrderSide(direction) {
  if (direction === "LONG") return "SELL";
  if (direction === "SHORT") return "BUY";
  throw new Error(`Direção inválida: ${direction}`);
}

function normalizeSignalForExecution(signalObj) {
  if (!signalObj || !signalObj.direction) return signalObj;

  const originalDirection = signalObj.direction;
  const originalSl = Number(signalObj.sl);
  const originalTp = Number(signalObj.tp);

  if (FUTURES_FOLLOW_SIGNAL_DIRECTION) {
    return {
      ...signalObj,
      side: getOpenOrderSide(originalDirection),
      originalDirection,
      executionDirectionMode: "FOLLOW",
      invertedSignal: false,
    };
  }

  const invertedDirection =
    originalDirection === "LONG"
      ? "SHORT"
      : originalDirection === "SHORT"
      ? "LONG"
      : originalDirection;

  return {
    ...signalObj,
    originalDirection,
    direction: invertedDirection,
    side: getOpenOrderSide(invertedDirection),
    sl: originalTp,
    tp: originalSl,
    executionDirectionMode: "INVERTED",
    invertedSignal: invertedDirection !== originalDirection,
  };
}

function calcPnlPct({ direction, entry, exit }) {
  const e = Number(entry);
  const x = Number(exit);
  if (!Number.isFinite(e) || !Number.isFinite(x) || e <= 0) return null;

  if (direction === "LONG") return ((x - e) / e) * 100;
  if (direction === "SHORT") return ((e - x) / e) * 100;

  return null;
}

function calcPnlUsd({ direction, entry, exit, quantity }) {
  const e = Number(entry);
  const x = Number(exit);
  const q = Number(quantity);
  if (!Number.isFinite(e) || !Number.isFinite(x) || !Number.isFinite(q)) return null;

  if (direction === "LONG") return (x - e) * q;
  if (direction === "SHORT") return (e - x) * q;

  return null;
}

function calcPositionSizeByRisk({
  accountSize,
  riskPerTrade,
  entry,
  sl,
  leverage,
}) {
  const riskUsd = Number(accountSize) * Number(riskPerTrade);
  const e = Number(entry);
  const s = Number(sl);
  const lev = Number(leverage);

  if (!Number.isFinite(riskUsd) || !Number.isFinite(e) || !Number.isFinite(s) || !Number.isFinite(lev)) {
    return null;
  }

  const stopDistancePct = Math.abs(e - s) / e;
  if (!Number.isFinite(stopDistancePct) || stopDistancePct <= 0) return null;

  const positionNotional = riskUsd / stopDistancePct;
  const marginRequired = positionNotional / lev;
  const quantity = positionNotional / e;

  return {
    riskUsd,
    stopDistancePct,
    positionNotional,
    marginRequired,
    quantity,
  };
}

function resolveAccountSizeReference({
  configuredAccountSize,
  availableBalance,
  mode = FUTURES_ACCOUNT_SIZE_MODE,
}) {
  const configured = Number(configuredAccountSize);
  const available = Number(availableBalance);
  const normalizedMode = String(mode || "auto").trim().toLowerCase();

  if (normalizedMode === "static") {
    return {
      accountSize:
        Number.isFinite(configured) && configured > 0 ? configured : ACCOUNT_SIZE,
      source: "static",
    };
  }

  if (
    (normalizedMode === "available_balance" || normalizedMode === "auto") &&
    Number.isFinite(available) &&
    available > 0
  ) {
    return {
      accountSize: available,
      source: "available_balance",
    };
  }

  return {
    accountSize:
      Number.isFinite(configured) && configured > 0 ? configured : ACCOUNT_SIZE,
    source: "static_fallback",
  };
}


function quoteAssetFromSymbol(symbol) {
  if (String(symbol).endsWith("USDC")) return "USDC";
  if (String(symbol).endsWith("USDT")) return "USDT";
  return "USDT";
}

function baseAssetFromSymbol(symbol) {
  const value = String(symbol || "").toUpperCase();
  if (value.endsWith("USDC") || value.endsWith("USDT")) {
    return value.slice(0, -4);
  }
  return value;
}

function normalizeAsset(value, fallback = null) {
  const asset = String(value || "").trim().toUpperCase();
  return asset || fallback;
}

function estimateCommissionQuoteEquivalent({
  symbol,
  price,
  commission,
  commissionAsset,
}) {
  const rawCommission = Number(commission);
  if (!Number.isFinite(rawCommission) || rawCommission <= 0) {
    return {
      quoteEquivalent: 0,
      convertible: true,
      mode: "none",
    };
  }

  const quoteAsset = normalizeAsset(quoteAssetFromSymbol(symbol), "USDT");
  const baseAsset = normalizeAsset(baseAssetFromSymbol(symbol), null);
  const asset = normalizeAsset(commissionAsset, quoteAsset);
  const fillPrice = Number(price);

  if (asset === quoteAsset) {
    return {
      quoteEquivalent: rawCommission,
      convertible: true,
      mode: "quote_asset",
    };
  }

  if (
    (asset === "USDT" && quoteAsset === "USDC") ||
    (asset === "USDC" && quoteAsset === "USDT")
  ) {
    return {
      quoteEquivalent: rawCommission,
      convertible: true,
      mode: "stablecoin_1to1",
    };
  }

  if (asset === "BNFCR") {
    return {
      quoteEquivalent: rawCommission,
      convertible: true,
      mode: "binance_futures_credit_1to1",
    };
  }

  if (baseAsset && asset === baseAsset && Number.isFinite(fillPrice) && fillPrice > 0) {
    return {
      quoteEquivalent: rawCommission * fillPrice,
      convertible: true,
      mode: "base_asset_mark_to_quote",
    };
  }

  return {
    quoteEquivalent: null,
    convertible: false,
    mode: "unknown_asset",
  };
}

function summarizeFillFees(symbol, fills = []) {
  const feeAssetBreakdown = {};
  const feeModes = {};
  let feesQuoteEquivalent = 0;
  let hasAnyFee = false;
  let feesConvertible = true;

  for (const fill of Array.isArray(fills) ? fills : []) {
    const commission = Number(fill?.commission);
    if (!Number.isFinite(commission) || commission <= 0) continue;

    const asset = normalizeAsset(fill?.commissionAsset, quoteAssetFromSymbol(symbol));
    feeAssetBreakdown[asset] = round((feeAssetBreakdown[asset] || 0) + commission, 12);

    const conversion = estimateCommissionQuoteEquivalent({
      symbol,
      price: fill?.price,
      commission,
      commissionAsset: asset,
    });

    feeModes[asset] = feeModes[asset] || conversion.mode;
    hasAnyFee = true;

    if (Number.isFinite(Number(conversion.quoteEquivalent))) {
      feesQuoteEquivalent += Number(conversion.quoteEquivalent);
    } else {
      feesConvertible = false;
    }
  }

  return {
    feeAssetBreakdown,
    feeConversionModes: feeModes,
    hasAnyFee,
    feesConvertible,
    feesQuoteEquivalent: hasAnyFee
      ? round(feesQuoteEquivalent, 12)
      : 0,
  };
}

function summarizeOrderFills(symbol, fills = []) {
  const rows = Array.isArray(fills) ? fills : [];
  const feeSummary = summarizeFillFees(symbol, rows);
  let qty = 0;
  let quoteQty = 0;
  let realizedPnl = 0;
  let hasRealizedPnl = false;
  let lastFillTime = null;

  for (const fill of rows) {
    qty += Number(fill?.qty || 0);
    quoteQty += Number(fill?.quoteQty || 0);
    if (Number.isFinite(Number(fill?.realizedPnl))) {
      realizedPnl += Number(fill.realizedPnl);
      hasRealizedPnl = true;
    }
    if (Number.isFinite(Number(fill?.time))) {
      lastFillTime = Math.max(lastFillTime || 0, Number(fill.time));
    }
  }

  return {
    avgPrice: averagePriceFromFills(rows),
    qty: qty > 0 ? qty : null,
    quoteQty: quoteQty > 0 ? quoteQty : null,
    realizedPnlGross: hasRealizedPnl ? round(realizedPnl, 12) : null,
    lastFillTime,
    ...feeSummary,
  };
}

function buildExecutionAuditFields(execution) {
  return {
    riskPerTrade: hasFiniteNumberValue(execution?.riskPerTrade)
      ? Number(execution.riskPerTrade)
      : null,
    executionBucket: execution?.executionBucket ?? null,
    accountSizeReference: hasFiniteNumberValue(execution?.accountSizeReference)
      ? Number(execution.accountSizeReference)
      : null,
    accountSizeSource: execution?.accountSizeSource ?? null,
    entryPlanned: hasFiniteNumberValue(execution?.entryPlanned)
      ? Number(execution.entryPlanned)
      : null,
    entryFill: hasFiniteNumberValue(execution?.entryFill)
      ? Number(execution.entryFill)
      : null,
    exitPlanned: hasFiniteNumberValue(execution?.exitPlanned)
      ? Number(execution.exitPlanned)
      : null,
    exitFill: hasFiniteNumberValue(execution?.exitFill)
      ? Number(execution.exitFill)
      : null,
    pnlTheoretical: hasFiniteNumberValue(execution?.pnlTheoretical)
      ? Number(execution.pnlTheoretical)
      : null,
    pnlRealizedGross: hasFiniteNumberValue(execution?.pnlRealizedGross)
      ? Number(execution.pnlRealizedGross)
      : null,
    fees: hasFiniteNumberValue(execution?.fees) ? Number(execution.fees) : null,
    pnlRealizedNet: hasFiniteNumberValue(execution?.pnlRealizedNet)
      ? Number(execution.pnlRealizedNet)
      : null,
    closeReasonInternal: execution?.closeReasonInternal ?? execution?.closeReason ?? null,
    closeReasonExchange: execution?.closeReasonExchange ?? null,
    pnlSource: execution?.pnlSource ?? null,
    attachedExitsPlaced:
      execution?.exchange && Object.prototype.hasOwnProperty.call(execution.exchange, "attachedExitsPlaced")
        ? execution.exchange.attachedExitsPlaced
        : null,
    slOrderId: execution?.exchange?.slOrderId ?? null,
    tpOrderId: execution?.exchange?.tpOrderId ?? null,
    protectionStatus: execution?.exchange?.protectionStatus ?? null,
    attachError: execution?.exchange?.attachError ?? null,
    slOrderMode: execution?.exchange?.slOrderMode ?? null,
    tpOrderMode: execution?.exchange?.tpOrderMode ?? null,
  };
}

function logReconcileWarning(orderId) {
  console.warn(`[RECONCILE][WARN] Missing Binance fills for orderId=${orderId}`);
}

function logReconcileMismatch({ symbol, internalPnl, binancePnl }) {
  const internal = Number(internalPnl);
  const binance = Number(binancePnl);
  if (!Number.isFinite(internal) || !Number.isFinite(binance)) return;

  const diff = internal - binance;
  if (Math.abs(diff) < 1e-8) return;

  console.warn(
    `[RECONCILE][MISMATCH] symbol=${symbol} internalPnl=${round(
      internal,
      8
    )} binancePnl=${round(binance, 8)} diff=${round(diff, 8)}`
  );
}

async function sendProtectionAlert(message) {
  if (EXECUTION_MODE !== "binance_real") return;
  if (!ENABLE_TELEGRAM || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
      },
      {
        timeout: 10000,
      }
    );
  } catch (err) {
    console.warn(
      "[FUTURES_TPSL] failed to send Telegram protection alert:",
      err?.response?.data || err.message || err
    );
  }
}

async function fetchAvailableFuturesBalance(asset) {
  try {
    if (typeof binance.futuresBalance === "function") {
      const rows = await binance.futuresBalance();
      const row = Array.isArray(rows)
        ? rows.find((r) => String(r.asset).toUpperCase() === String(asset).toUpperCase())
        : null;

      const available = Number(
        row?.availableBalance ??
        row?.available ??
        row?.balance
      );

      if (Number.isFinite(available) && available > 0) {
        return available;
      }
    }
  } catch {}

  try {
    if (typeof binance.futuresAccount === "function") {
      const acc = await binance.futuresAccount();
      const row = Array.isArray(acc?.assets)
        ? acc.assets.find((r) => String(r.asset).toUpperCase() === String(asset).toUpperCase())
        : null;

      const available = Number(
        row?.availableBalance ??
        row?.walletBalance ??
        row?.marginBalance
      );

      if (Number.isFinite(available) && available > 0) {
        return available;
      }
    }
  } catch {}

  return null;
}

function getPositionSideForDirection(direction) {
  return String(direction).toUpperCase() === "SHORT" ? "SHORT" : "LONG";
}

async function fetchOpenFuturesPosition(symbol, direction) {
  const wantSide = getPositionSideForDirection(direction);
  const fn =
    binance.futuresPositionRisk ||
    binance.futuresPositionInformation ||
    binance.futuresPositionInfo;

  if (typeof fn !== "function") return null;

  const positions = await fn.call(binance);
  if (!Array.isArray(positions)) return null;

  return (
    positions.find((p) => {
      if (!p || String(p.symbol) !== String(symbol)) return false;

      if (FUTURES_POSITION_MODE === "HEDGE") {
        return String(p.positionSide).toUpperCase() === wantSide;
      }

      return true;
    }) || null
  );
}

async function fetchFuturesOrderStatus(symbol, { orderId = null, clientOrderId = null } = {}) {
  if (typeof binance.futuresOrderStatus !== "function") return null;
  if (!orderId && !clientOrderId) return null;

  const params = {};
  if (orderId) params.orderId = orderId;
  if (clientOrderId) params.origClientOrderId = clientOrderId;

  try {
    return await binance.futuresOrderStatus(symbol, params);
  } catch (err) {
    console.warn(
      `[FUTURES_EXECUTOR] falha ao consultar status da ordem ${symbol}:`,
      err.body || err.message || err
    );
    return null;
  }
}

function normalizeUserTradeFill(fill = {}) {
  return {
    id: fill.id ?? null,
    orderId: fill.orderId ?? null,
    symbol: fill.symbol ?? null,
    side: fill.side ?? null,
    positionSide: fill.positionSide ?? null,
    price: toNumber(fill.price),
    qty: toNumber(fill.qty),
    quoteQty: toNumber(fill.quoteQty),
    realizedPnl: toNumber(fill.realizedPnl),
    commission: toNumber(fill.commission),
    commissionAsset: fill.commissionAsset ?? null,
    time: fill.time ?? null,
    maker: Boolean(fill.maker),
    buyer: Boolean(fill.buyer),
  };
}

async function fetchFuturesUserTradeFills(symbol, { orderId = null, limit = 20 } = {}) {
  if (typeof binance.futuresUserTrades !== "function") return [];
  if (!orderId) return [];

  try {
    const rows = await binance.futuresUserTrades(symbol, { orderId, limit });
    return Array.isArray(rows) ? rows.map(normalizeUserTradeFill) : [];
  } catch (err) {
    console.warn(
      `[FUTURES_EXECUTOR] falha ao consultar fills ${symbol}:`,
      err.body || err.message || err
    );
    return [];
  }
}

function averagePriceFromFills(fills = []) {
  let qtySum = 0;
  let notionalSum = 0;

  for (const fill of Array.isArray(fills) ? fills : []) {
    const qty = toNumber(fill.qty);
    const price = toNumber(fill.price);
    if (qty <= 0 || price <= 0) continue;
    qtySum += qty;
    notionalSum += qty * price;
  }

  if (qtySum <= 0 || notionalSum <= 0) return null;
  return notionalSum / qtySum;
}

function reconcileExecutionOrderData(execution, phase, orderStatus, fills = []) {
  const prefix = phase === "close" ? "close" : "open";
  const avgStatusPrice = toNumber(orderStatus?.avgPrice);
  const fillSummary = summarizeOrderFills(execution?.symbol, fills);
  const avgFillPrice = Number(fillSummary.avgPrice);
  const resolvedAvgPrice = avgFillPrice > 0 ? avgFillPrice : avgStatusPrice;
  const executedQty = toNumber(
    orderStatus?.executedQty ?? orderStatus?.cumQty ?? orderStatus?.origQty
  );
  const quoteQty = toNumber(orderStatus?.cumQuote ?? orderStatus?.cumQuoteQty);
  const orderId = execution?.exchange?.[`${prefix}OrderId`] ?? null;
  const effectiveExecutedQty =
    Number.isFinite(Number(fillSummary.qty)) && Number(fillSummary.qty) > 0
      ? Number(fillSummary.qty)
      : executedQty;
  const effectiveQuoteQty =
    Number.isFinite(Number(fillSummary.quoteQty)) && Number(fillSummary.quoteQty) > 0
      ? Number(fillSummary.quoteQty)
      : quoteQty;

  if (
    orderId &&
    (!Array.isArray(fills) || fills.length === 0) &&
    (String(orderStatus?.status || "").toUpperCase() === "FILLED" || executedQty > 0)
  ) {
    logReconcileWarning(orderId);
  }

  execution.exchange[`${prefix}Status`] =
    orderStatus?.status ?? execution.exchange[`${prefix}Status`] ?? null;
  execution.exchange[`${prefix}ExecutedQty`] =
    effectiveExecutedQty > 0
      ? String(effectiveExecutedQty)
      : execution.exchange[`${prefix}ExecutedQty`] ?? null;
  execution.exchange[`${prefix}QuoteQty`] =
    effectiveQuoteQty > 0
      ? String(effectiveQuoteQty)
      : execution.exchange[`${prefix}QuoteQty`] ?? null;
  execution.exchange[`${prefix}TransactTime`] =
    fillSummary.lastFillTime ??
    orderStatus?.updateTime ??
    orderStatus?.time ??
    execution.exchange[`${prefix}TransactTime`] ??
    Date.now();

  if (fills.length > 0) {
    execution.exchange[`${prefix}Fills`] = fills;
  }

  execution.exchange[`${prefix}FeeAssetBreakdown`] = fillSummary.feeAssetBreakdown;
  execution.exchange[`${prefix}FeeConversionModes`] = fillSummary.feeConversionModes;
  execution.exchange[`${prefix}Fees`] = fillSummary.feesQuoteEquivalent;
  execution.exchange[`${prefix}FeesConvertible`] = fillSummary.feesConvertible;
  execution.exchange[`${prefix}RealizedPnl`] = fillSummary.realizedPnlGross;

  if (phase === "open") {
    if (effectiveExecutedQty > 0) {
      execution.quantity = round(effectiveExecutedQty, 6);
    }

    if (effectiveQuoteQty > 0) {
      execution.tradeUsd = round(effectiveQuoteQty, 6);
      execution.positionNotional = round(effectiveQuoteQty, 6);
      if (Number.isFinite(Number(execution.leverage)) && Number(execution.leverage) > 0) {
        execution.marginRequired = round(
          effectiveQuoteQty / Number(execution.leverage),
          6
        );
      }
    }

    if (resolvedAvgPrice && resolvedAvgPrice > 0) {
      execution.entryFill = resolvedAvgPrice;
      execution.entry = resolvedAvgPrice;
      execution.entryPrice = resolvedAvgPrice;
      execution.exchange.entryPriceSource =
        avgFillPrice > 0 ? "userTrades.avgPrice" : "orderStatus.avgPrice";
    }

    execution.openFees = fillSummary.feesQuoteEquivalent;
    execution.openFeeAssetBreakdown = fillSummary.feeAssetBreakdown;
    execution.openFeesConvertible = fillSummary.feesConvertible;
  } else {
    if (resolvedAvgPrice && resolvedAvgPrice > 0) {
      execution.exitFill = resolvedAvgPrice;
    }

    execution.closeFees = fillSummary.feesQuoteEquivalent;
    execution.closeFeeAssetBreakdown = fillSummary.feeAssetBreakdown;
    execution.closeFeesConvertible = fillSummary.feesConvertible;
    execution.pnlRealizedGross =
      Number.isFinite(Number(fillSummary.realizedPnlGross))
        ? Number(fillSummary.realizedPnlGross)
        : execution.pnlRealizedGross ?? null;
  }

  return {
    avgPrice: resolvedAvgPrice && resolvedAvgPrice > 0 ? resolvedAvgPrice : null,
    executedQty: effectiveExecutedQty > 0 ? effectiveExecutedQty : null,
    quoteQty: effectiveQuoteQty > 0 ? effectiveQuoteQty : null,
    realizedPnlGross: fillSummary.realizedPnlGross,
    feesQuoteEquivalent: fillSummary.feesQuoteEquivalent,
    feesConvertible: fillSummary.feesConvertible,
    feeAssetBreakdown: fillSummary.feeAssetBreakdown,
    lastFillTime: fillSummary.lastFillTime,
  };
}

async function isExecutionStillOpenOnExchange(execution) {
  try {
    const position = await fetchOpenFuturesPosition(
      execution.symbol,
      execution.direction
    );

    if (!position) return false;

    const qty = Math.abs(
      Number(
        position.positionAmt ??
          position.positionAmount ??
          position.qty ??
          position.amount ??
          0
      )
    );

    return Number.isFinite(qty) && qty > 0;
  } catch (err) {
    console.warn(
      `[FUTURES_EXECUTOR] falha ao reconciliar posição ${execution.symbol}:`,
      err.body || err.message || err
    );
    return true;
  }
}

function markExecutionClosed({
  execution,
  closeReason,
  exitPrice,
  exitPlanned = null,
  logType,
  exchangePatch = {},
}) {
  execution.status = "CLOSED";
  execution.closedTs = Date.now();
  execution.closeReason = closeReason;
  execution.closeReasonInternal = closeReason;
  execution.closeReasonExchange =
    exchangePatch.closeReasonExchange ??
    execution.closeReasonExchange ??
    closeReason;
  execution.exitPlanned = hasFiniteNumberValue(exitPlanned)
    ? Number(exitPlanned)
    : hasFiniteNumberValue(execution.exitPlanned)
    ? Number(execution.exitPlanned)
    : null;
  execution.entryPlanned = hasFiniteNumberValue(execution.entryPlanned)
    ? Number(execution.entryPlanned)
    : hasFiniteNumberValue(execution.projectedEntry)
    ? Number(execution.projectedEntry)
    : Number(execution.entry);
  execution.entryFill = hasFiniteNumberValue(execution.entryFill)
    ? Number(execution.entryFill)
    : hasFiniteNumberValue(execution.entryPrice)
    ? Number(execution.entryPrice)
    : Number(execution.entry);
  execution.exitFill = hasFiniteNumberValue(execution.exitFill)
    ? Number(execution.exitFill)
    : Number(exitPrice);
  execution.exitPrice = Number(execution.exitFill);

  execution.pnlTheoretical = calcPnlUsd({
    direction: execution.direction,
    entry: execution.entryPlanned,
    exit: execution.exitPlanned ?? execution.exitPrice,
    quantity: execution.quantity,
  });
  execution.pnlTheoreticalPct = calcPnlPct({
    direction: execution.direction,
    entry: execution.entryPlanned,
    exit: execution.exitPlanned ?? execution.exitPrice,
  });

  const realizedGrossFallback = calcPnlUsd({
    direction: execution.direction,
    entry: execution.entryFill,
    exit: execution.exitPrice,
    quantity: execution.quantity,
  });
  const realizedGross =
    Number.isFinite(Number(execution.pnlRealizedGross))
      ? Number(execution.pnlRealizedGross)
      : realizedGrossFallback;
  const totalFees =
    Number.isFinite(Number(execution.openFees)) || Number.isFinite(Number(execution.closeFees))
      ? round(Number(execution.openFees || 0) + Number(execution.closeFees || 0), 12)
      : null;

  execution.pnlRealizedGross = Number.isFinite(Number(realizedGross))
    ? Number(realizedGross)
    : null;
  execution.fees = Number.isFinite(Number(totalFees)) ? Number(totalFees) : null;
  execution.feesConvertible =
    execution.openFeesConvertible !== false && execution.closeFeesConvertible !== false;
  execution.pnlRealizedNet =
    Number.isFinite(Number(execution.pnlRealizedGross)) && Number.isFinite(Number(execution.fees))
      ? Number(execution.pnlRealizedGross) - Number(execution.fees)
      : execution.pnlRealizedGross;
  execution.pnlRealizedGrossPct =
    Number.isFinite(Number(execution.pnlRealizedGross)) &&
    Number.isFinite(Number(execution.tradeUsd)) &&
    Number(execution.tradeUsd) > 0
      ? (Number(execution.pnlRealizedGross) / Number(execution.tradeUsd)) * 100
      : calcPnlPct({
          direction: execution.direction,
          entry: execution.entryFill,
          exit: execution.exitPrice,
        });
  execution.pnlRealizedNetPct =
    Number.isFinite(Number(execution.pnlRealizedNet)) &&
    Number.isFinite(Number(execution.tradeUsd)) &&
    Number(execution.tradeUsd) > 0
      ? (Number(execution.pnlRealizedNet) / Number(execution.tradeUsd)) * 100
      : execution.pnlRealizedGrossPct;
  execution.pnlSource =
    Array.isArray(execution?.exchange?.closeFills) && execution.exchange.closeFills.length
      ? "binance_fill"
      : Number.isFinite(Number(execution.exitFill))
      ? "order_status"
      : "theoretical_fallback";
  execution.pnlUsd = Number.isFinite(Number(execution.pnlRealizedNet))
    ? Number(execution.pnlRealizedNet)
    : Number.isFinite(Number(execution.pnlRealizedGross))
    ? Number(execution.pnlRealizedGross)
    : Number(execution.pnlTheoretical);
  execution.pnlPct = Number.isFinite(Number(execution.pnlRealizedNetPct))
    ? Number(execution.pnlRealizedNetPct)
    : Number.isFinite(Number(execution.pnlRealizedGrossPct))
    ? Number(execution.pnlRealizedGrossPct)
    : Number(execution.pnlTheoreticalPct);

  if (
    execution.pnlSource === "binance_fill" &&
    Number.isFinite(Number(execution.pnlTheoretical)) &&
    Number.isFinite(Number(execution.pnlRealizedGross))
  ) {
    logReconcileMismatch({
      symbol: execution.symbol,
      internalPnl: execution.pnlTheoretical,
      binancePnl: execution.pnlRealizedGross,
    });
  }

  execution.exchange = {
    ...(execution.exchange || {}),
    ...exchangePatch,
  };

  appendOrderLog({
    ts: execution.closedTs,
    type: logType,
    symbol: execution.symbol,
    direction: execution.direction,
    quantity: execution.quantity,
    exitPrice: execution.exitPrice,
    pnlPct: execution.pnlPct,
    pnlUsd: execution.pnlUsd,
    closeReason: execution.closeReason,
    linkedExecutionId: execution.id,
    ...buildExecutionAuditFields(execution),
    exchange: execution.exchange,
  });

  return execution;
}

function capSizingToBalance({ sizing, entry, leverage, availableBalance, maxPositionUsd }) {
  const e = Number(entry);
  const lev = Number(leverage);
  const avail = Number(availableBalance);
  const maxPos = Number(maxPositionUsd);

  if (!Number.isFinite(e) || e <= 0 || !Number.isFinite(lev) || lev <= 0) {
    return null;
  }

  let cappedNotional = Number(sizing.positionNotional);

  if (Number.isFinite(maxPos) && maxPos > 0) {
    cappedNotional = Math.min(cappedNotional, maxPos);
  }

  if (Number.isFinite(avail) && avail > 0) {
    const maxNotionalFromBalance = avail * FUTURES_BALANCE_BUFFER_PCT * lev;
    cappedNotional = Math.min(cappedNotional, maxNotionalFromBalance);
  }

  if (!Number.isFinite(cappedNotional) || cappedNotional <= 0) {
    return null;
  }

  const quantity = cappedNotional / e;
  const marginRequired = cappedNotional / lev;
  const riskUsd = cappedNotional * Number(sizing.stopDistancePct || 0);

  return {
    ...sizing,
    riskUsd: Number.isFinite(riskUsd) ? riskUsd : sizing.riskUsd,
    positionNotional: cappedNotional,
    marginRequired,
    quantity,
  };
}

function validateSignalForFutures(signalObj, state) {
  if (!signalObj?.direction) {
    return { ok: false, reason: "missing_direction" };
  }

  const entry = Number(signalObj.entry);
  const sl = Number(signalObj.sl);
  const direction = String(signalObj.direction).toUpperCase();

  if (!Number.isFinite(entry) || !Number.isFinite(sl)) {
    return { ok: false, reason: "invalid_stop_values" };
  }

  if (direction === "LONG" && sl >= entry) {
    return { ok: false, reason: "invalid_stop_geometry" };
  }

  if (direction === "SHORT" && sl <= entry) {
    return { ok: false, reason: "invalid_stop_geometry" };
  }

  if (signalObj.direction === "LONG" && !FUTURES_ALLOW_LONG) {
    return { ok: false, reason: "long_disabled" };
  }

  if (signalObj.direction === "SHORT" && !FUTURES_ALLOW_SHORT) {
    return { ok: false, reason: "short_disabled" };
  }

  if (countOpenPositions(state) >= FUTURES_MAX_OPEN_POSITIONS) {
    return { ok: false, reason: "max_open_positions_reached" };
  }

  if (countOpenPositions(state, signalObj.symbol) >= FUTURES_MAX_OPEN_PER_SYMBOL) {
    return { ok: false, reason: "max_open_positions_per_symbol_reached" };
  }

  return { ok: true };
}

function makeExecutionId(symbol, mode = "paper", direction = "LONG") {
  return `futures_${mode}_${Date.now()}_${symbol}_${direction}`;
}

async function applyFuturesSymbolSettings(symbol, leverage) {
  const lev = Number(leverage || FUTURES_DEFAULT_LEVERAGE);

  try {
    await binance.futuresLeverage(symbol, lev);
  } catch (err) {
    console.warn(`[FUTURES_EXECUTOR] futuresLeverage falhou em ${symbol}:`, err.body || err.message || err);
  }

    if (FUTURES_SET_MARGIN_TYPE) {
    try {
      await binance.futuresMarginType(symbol, FUTURES_MARGIN_TYPE);
    } catch (err) {
      const msg = JSON.stringify(err.body || err.message || err);
      if (!msg.includes("No need to change margin type")) {
        console.warn(
          `[FUTURES_EXECUTOR] futuresMarginType falhou em ${symbol}:`,
          err.body || err.message || err
        );
      }
    }
  }
}

function buildBaseExecution(signalObj, sizing, options = {}) {
  const leverage = Number(options.leverage || FUTURES_DEFAULT_LEVERAGE);
  const riskPerTrade = Number(
    options.riskPerTrade ?? signalObj.executionRiskPerTrade ?? FUTURES_RISK_PER_TRADE
  );

  return {
    id: makeExecutionId(
      signalObj.symbol,
      EXECUTION_MODE === "binance_real" ? "real" : "paper",
      signalObj.direction
    ),
    status: "OPEN",
    mode: EXECUTION_MODE,
    symbol: signalObj.symbol,
    tf: signalObj.tf,
    strategy: signalObj.strategy,
    direction: signalObj.direction,
    originalDirection: signalObj.originalDirection || signalObj.direction,
    executionDirectionMode: signalObj.executionDirectionMode || "FOLLOW",
    invertedSignal: Boolean(signalObj.invertedSignal),
    signalClass: signalObj.signalClass,
    score: signalObj.score,
    riskPerTrade: Number.isFinite(riskPerTrade) ? round(riskPerTrade, 6) : null,
    executionBucket: signalObj.executionBucket || null,
    accountSizeReference: Number.isFinite(Number(options.accountSizeReference))
      ? round(Number(options.accountSizeReference), 6)
      : null,
    accountSizeSource: options.accountSizeSource || null,

    side: getOpenOrderSide(signalObj.direction),
    entry: Number(signalObj.entry),
    sl: Number(signalObj.sl),
    tp: Number(signalObj.tp),

    leverage,
    marginType: FUTURES_MARGIN_TYPE,
    positionMode: FUTURES_POSITION_MODE,

    riskUsd: round(sizing.riskUsd, 6),
    stopDistancePct: round(sizing.stopDistancePct, 6),
    positionNotional: round(sizing.positionNotional, 6),
    marginRequired: round(sizing.marginRequired, 6),
    quantity: round(sizing.quantity, 6),

    tradeUsd: round(sizing.positionNotional, 6),

    openedTs: Date.now(),
    closedTs: null,
    closeReason: null,
    closeReasonInternal: null,
    closeReasonExchange: null,

    entryPlanned: Number(signalObj.entry),
    entryFill: null,
    entryPrice: Number(signalObj.entry),
    exitPlanned: null,
    exitFill: null,
    exitPrice: null,
    pnlTheoretical: null,
    pnlTheoreticalPct: null,
    pnlRealizedGross: null,
    pnlRealizedGrossPct: null,
    fees: null,
    feesConvertible: null,
    pnlRealizedNet: null,
    pnlRealizedNetPct: null,
    pnlSource: null,
    pnlPct: null,
    pnlUsd: null,

    exchange: {
      test: EXECUTION_MODE !== "binance_real",
      openOrderId: null,
      closeOrderId: null,
      openClientOrderId: null,
      closeClientOrderId: null,
      openStatus: null,
      closeStatus: null,
      openExecutedQty: null,
      closeExecutedQty: null,
      openQuoteQty: null,
      closeQuoteQty: null,
      openTransactTime: null,
      closeTransactTime: null,
      openFills: [],
      closeFills: [],
      attachedExitsPlaced: false,
      protectionStatus:
        EXECUTION_MODE === "binance_real" && FUTURES_ATTACH_TPSL_ON_ENTRY
          ? "pending"
          : "n/a",
      attachError: null,
      slOrderMode: "STOP_MARKET",
      tpOrderMode: "TAKE_PROFIT_MARKET",
      tpAlgoId: null,
      tpClientAlgoId: null,
      tpOrderId: null,
      tpClientOrderId: null,
      tpStatus: null,
      tpType: null,
      tpStopPrice: null,
      tpPlacedTs: null,
      tpCancelTs: null,
      slAlgoId: null,
      slClientAlgoId: null,
      slOrderId: null,
      slClientOrderId: null,
      slStatus: null,
      slType: null,
      slStopPrice: null,
      slPlacedTs: null,
      slCancelTs: null,
    },
  };
}

function buildAttachedExitCommon(direction) {
  const isLong = String(direction).toUpperCase() === "LONG";
  const closeSide = isLong ? "SELL" : "BUY";

  return {
    reduceOnly: true,
    workingType: FUTURES_TPSL_WORKING_TYPE,
    priceProtect: FUTURES_TPSL_PRICE_PROTECT ? "TRUE" : "FALSE",
    side: closeSide,
    positionSide:
      FUTURES_POSITION_MODE === "HEDGE"
        ? isLong
          ? "LONG"
          : "SHORT"
        : undefined,
  };
}

function buildAttachedExitClientOrderId(prefix, execution) {
  const safePrefix = String(prefix || "ex").replace(/[^a-z]/gi, "").slice(0, 3) || "ex";
  const safeSymbol = String(execution?.symbol || "SYM")
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 8);
  const nonce = Date.now().toString(36);
  return `${safePrefix}_${safeSymbol}_${nonce}`.slice(0, 36);
}

function getAttachedExitRefs(execution, prefix) {
  const exchange = execution?.exchange || {};
  return {
    orderId:
      exchange[`${prefix}AlgoId`] ??
      exchange[`${prefix}OrderId`] ??
      null,
    clientOrderId:
      exchange[`${prefix}ClientAlgoId`] ??
      exchange[`${prefix}ClientOrderId`] ??
      null,
  };
}

function isIgnorableAttachedExitError(err) {
  const raw = err?.body?.msg || err?.message || String(err || "");
  const msg = String(raw).toLowerCase();
  return (
    msg.includes("unknown order") ||
    msg.includes("order does not exist") ||
    msg.includes("does not exist") ||
    msg.includes("already closed") ||
    msg.includes("filled")
  );
}

async function placeAttachedFuturesExit(execution, prefix, stopPrice) {
  if (typeof binance.futuresOrder !== "function") {
    throw new Error("futuresOrder_unavailable");
  }

  const type = prefix === "tp" ? "TAKE_PROFIT_MARKET" : "STOP_MARKET";
  const clientOrderId = buildAttachedExitClientOrderId(prefix, execution);
  const response = await binance.futuresOrder(
    type,
    execution.symbol,
    execution.quantity,
    false,
    {
      ...buildAttachedExitCommon(execution.direction),
      stopPrice,
      newClientOrderId: clientOrderId,
    }
  );

  const orderId = response?.orderId ?? response?.algoId ?? null;
  const resolvedClientOrderId = response?.clientOrderId ?? clientOrderId;
  const now = Date.now();

  execution.exchange = execution.exchange || {};
  execution.exchange[`${prefix}AlgoId`] = orderId;
  execution.exchange[`${prefix}ClientAlgoId`] = resolvedClientOrderId;
  execution.exchange[`${prefix}OrderId`] = orderId;
  execution.exchange[`${prefix}ClientOrderId`] = resolvedClientOrderId;
  execution.exchange[`${prefix}Status`] = response?.status ?? "NEW";
  execution.exchange[`${prefix}Type`] = type;
  execution.exchange[`${prefix}StopPrice`] = Number(stopPrice);
  execution.exchange[`${prefix}PlacedTs`] = now;
  execution.exchange[`${prefix}CancelTs`] = null;

  return response;
}

async function cancelAttachedFuturesExit(execution, prefix) {
  const { orderId, clientOrderId } = getAttachedExitRefs(execution, prefix);
  if (!orderId && !clientOrderId) {
    return {
      ok: false,
      reason: "missing_exit_ref",
    };
  }

  const params = {};
  if (!orderId && clientOrderId) {
    params.origClientOrderId = clientOrderId;
  }

  let response;
  if (typeof binance.futuresCancelAlgoOrder === "function") {
    response = await binance.futuresCancelAlgoOrder(
      execution.symbol,
      orderId || undefined,
      params
    );
  } else if (typeof binance.futuresCancel === "function") {
    response = await binance.futuresCancel(execution.symbol, orderId || undefined, {
      conditional: true,
      ...params,
    });
  } else {
    throw new Error("futures_cancel_algo_unavailable");
  }

  execution.exchange = execution.exchange || {};
  execution.exchange[`${prefix}Status`] = response?.status ?? "CANCELED";
  execution.exchange[`${prefix}CancelTs`] = Date.now();

  return {
    ok: true,
    response,
  };
}

async function cancelAllAttachedFuturesExits(execution) {
  for (const prefix of ["tp", "sl"]) {
    try {
      await cancelAttachedFuturesExit(execution, prefix);
    } catch (err) {
      if (!isIgnorableAttachedExitError(err)) {
        console.warn(
          `[FUTURES_TPSL] failed to cancel ${prefix.toUpperCase()} for ${execution.symbol}:`,
          err.body || err.message || err
        );
      }
    }
  }
}

async function attachFuturesTPSL(execution) {
  if (!FUTURES_ATTACH_TPSL_ON_ENTRY) {
    execution.exchange = execution.exchange || {};
    execution.exchange.protectionStatus = "disabled";
    return { ok: false, reason: "disabled" };
  }

  console.log(
    `[FUTURES_SL_DEBUG] symbol=${execution.symbol} direction=${execution.direction} qty=${execution.quantity} sl=${execution.sl} tp=${execution.tp}`
  );

  execution.exchange = execution.exchange || {};
  execution.exchange.attachedExitsPlaced = false;
  execution.exchange.protectionStatus = "pending";
  execution.exchange.attachError = null;
  execution.exchange.slOrderMode = "STOP_MARKET";
  execution.exchange.tpOrderMode = "TAKE_PROFIT_MARKET";

  try {
    await placeAttachedFuturesExit(execution, "sl", execution.sl);
  } catch (err) {
    const attachError = err?.body?.msg || err?.message || String(err);
    execution.exchange.attachedExitsPlaced = false;
    execution.exchange.protectionStatus = "unprotected";
    execution.exchange.attachError = attachError;

    appendOrderLog({
      ts: Date.now(),
      type: "futures_real_protection_critical",
      symbol: execution.symbol,
      direction: execution.direction,
      quantity: execution.quantity,
      linkedExecutionId: execution.id,
      error: attachError,
      ...buildExecutionAuditFields(execution),
      exchange: execution.exchange,
    });

    await sendProtectionAlert(
      `[FUTURES][CRITICAL] ${execution.symbol} ${execution.direction} ficou sem SL real na Binance. erro=${attachError}`
    );
    return {
      ok: false,
      protected: false,
      slPlaced: false,
      tpPlaced: false,
      error: attachError,
    };
  }

  try {
    await placeAttachedFuturesExit(execution, "tp", execution.tp);
    execution.exchange.attachedExitsPlaced = true;
    execution.exchange.protectionStatus = "protected";
  } catch (err) {
    const attachError = err?.body?.msg || err?.message || String(err);
    execution.exchange.attachedExitsPlaced = false;
    execution.exchange.protectionStatus = "sl_only";
    execution.exchange.attachError = attachError;

    appendOrderLog({
      ts: Date.now(),
      type: "futures_real_protection_warning",
      symbol: execution.symbol,
      direction: execution.direction,
      quantity: execution.quantity,
      linkedExecutionId: execution.id,
      error: attachError,
      ...buildExecutionAuditFields(execution),
      exchange: execution.exchange,
    });

    return {
      ok: false,
      protected: true,
      slPlaced: true,
      tpPlaced: false,
      error: attachError,
    };
  }

  console.log(
    `[FUTURES_TPSL] Attached SL/TP for ${execution.symbol} dir=${execution.direction} sl=${execution.sl} tp=${execution.tp}`
  );

  return {
    ok: true,
    protected: true,
    slPlaced: true,
    tpPlaced: true,
  };
}

async function moveExecutionStopToBreakEven(execution, newStopPrice, meta = {}) {
  if (EXECUTION_MODE !== "binance_real") {
    return { ok: false, reason: "not_binance_real" };
  }

  if (!FUTURES_ATTACH_TPSL_ON_ENTRY) {
    return { ok: false, reason: "attached_exits_disabled" };
  }

  const stopPrice = Number(newStopPrice);
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
    return { ok: false, reason: "invalid_stop_price" };
  }

  const previousStopPrice = Number(
    execution?.exchange?.slStopPrice ?? execution?.sl ?? NaN
  );
  const currentSlRefs = getAttachedExitRefs(execution, "sl");

  if (!currentSlRefs.orderId && !currentSlRefs.clientOrderId) {
    try {
      await placeAttachedFuturesExit(execution, "sl", stopPrice);
      execution.sl = stopPrice;
      execution.exchange = execution.exchange || {};
      execution.exchange.slStopPrice = stopPrice;
      execution.exchange.protectionStatus =
        execution.exchange.tpOrderId ? "protected" : "sl_only";

      appendOrderLog({
        ts: Date.now(),
        type: "futures_real_break_even_recreated_sl",
        symbol: execution.symbol,
        direction: execution.direction,
        quantity: execution.quantity,
        newStopPrice: stopPrice,
        linkedExecutionId: execution.id,
        triggerR: Number(meta.triggerR ?? null),
        ...buildExecutionAuditFields(execution),
        exchange: execution.exchange,
      });

      return {
        ok: true,
        recreated: true,
        previousStopPrice,
        stopPrice,
      };
    } catch (err) {
      const attachError = err?.body?.msg || err?.message || String(err);
      execution.exchange = execution.exchange || {};
      execution.exchange.protectionStatus = "unprotected";
      execution.exchange.attachError = attachError;

      appendOrderLog({
        ts: Date.now(),
        type: "futures_real_break_even_critical",
        symbol: execution.symbol,
        direction: execution.direction,
        quantity: execution.quantity,
        newStopPrice: stopPrice,
        linkedExecutionId: execution.id,
        error: attachError,
        ...buildExecutionAuditFields(execution),
        exchange: execution.exchange,
      });

      await sendProtectionAlert(
        `[FUTURES][CRITICAL] ${execution.symbol} ${execution.direction} não conseguiu recriar SL no break-even. erro=${attachError}`
      );

      return {
        ok: false,
        reason: "missing_sl_order_recreate_failed",
        error: attachError,
      };
    }
  }

  try {
    await cancelAttachedFuturesExit(execution, "sl");
  } catch (err) {
    if (!isIgnorableAttachedExitError(err)) {
      throw err;
    }
  }

  try {
    await placeAttachedFuturesExit(execution, "sl", stopPrice);
  } catch (err) {
    if (Number.isFinite(previousStopPrice) && previousStopPrice > 0) {
      try {
        await placeAttachedFuturesExit(execution, "sl", previousStopPrice);
      } catch (restoreErr) {
        console.warn(
          `[FUTURES_TPSL] failed to restore previous SL for ${execution.symbol}:`,
          restoreErr.body || restoreErr.message || restoreErr
        );
      }
    }
    throw err;
  }

  execution.sl = stopPrice;
  execution.exchange = execution.exchange || {};
  execution.exchange.slStopPrice = stopPrice;
  execution.exchange.protectionStatus =
    execution.exchange.tpOrderId ? "protected" : "sl_only";

  appendOrderLog({
    ts: Date.now(),
    type: "futures_real_break_even_update",
    symbol: execution.symbol,
    direction: execution.direction,
    quantity: execution.quantity,
    previousStopPrice,
    newStopPrice: stopPrice,
    linkedExecutionId: execution.id,
    triggerR: Number(meta.triggerR ?? null),
    ...buildExecutionAuditFields(execution),
    exchange: execution.exchange,
  });

  return {
    ok: true,
    previousStopPrice,
    stopPrice,
  };
}

async function openRealFuturesPosition(execution) {
  await applyFuturesSymbolSettings(execution.symbol, execution.leverage);

  // Keep the signal/projection entry for debugging / dashboard comparisons.
  // execution.entry may start as the candle/signal price, but Binance will fill at a different price.
  if (!Number.isFinite(Number(execution.projectedEntry))) {
    execution.projectedEntry = Number(execution.entry);
  }

  const openSide = getOpenOrderSide(execution.direction);
  const filters = await initFuturesFilters(execution.symbol);
  const refPrice = await fetchFuturesReferencePrice(execution.symbol).catch(() =>
    Number(execution.entry || 0)
  );

  const qty = adjustFuturesQty(execution.quantity, filters, refPrice);

  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`invalid_quantity_after_filters:${execution.symbol}`);
  }

  execution.quantity = qty;

  console.log(
    `[FUTURES_EXECUTOR] ${execution.symbol} qtyRaw=${round(
      execution.positionNotional / execution.entry,
      8
    )} qtySafe=${qty} stepSize=${filters.stepSize} minQty=${filters.minQty} refPrice=${round(
      refPrice,
      8
    )}`
  );

  let response;
  if (openSide === "BUY") {
    response = await binance.futuresMarketBuy(execution.symbol, qty, {
      positionSide: FUTURES_POSITION_MODE === "HEDGE" ? "LONG" : undefined,
    });
  } else {
    response = await binance.futuresMarketSell(execution.symbol, qty, {
      positionSide: FUTURES_POSITION_MODE === "HEDGE" ? "SHORT" : undefined,
    });
  }

  execution.exchange.openOrderId = response?.orderId ?? null;
  execution.exchange.openClientOrderId = response?.clientOrderId ?? null;
  execution.exchange.openStatus = response?.status ?? null;
  execution.exchange.openExecutedQty = response?.executedQty ?? null;
  execution.exchange.openQuoteQty = response?.cumQuote ?? null;
  execution.exchange.openTransactTime = response?.updateTime ?? Date.now();
  execution.exchange.openFills = response?.fills || [];

  const orderStatus = await fetchFuturesOrderStatus(execution.symbol, {
    orderId: execution.exchange.openOrderId,
    clientOrderId: execution.exchange.openClientOrderId,
  });
  const userTradeFills = await fetchFuturesUserTradeFills(execution.symbol, {
    orderId: execution.exchange.openOrderId,
  });

  const reconciledEntry = reconcileExecutionOrderData(
    execution,
    "open",
    orderStatus,
    userTradeFills
  );

  // IMPORTANT:
  // Binance Futures market orders often return avgPrice=0 (depending on endpoint/library).
  // If we don't sync the *actual* entry price, the dashboard and PnL calculations drift
  // (you'll see projected entry from the signal vs real position entry in Binance).
  //
  // 1) Try avgPrice when available
  const respAvg = Number(response?.avgPrice);
  if (Number.isFinite(Number(reconciledEntry?.avgPrice)) && Number(reconciledEntry.avgPrice) > 0) {
    execution.entry = Number(reconciledEntry.avgPrice);
    execution.entryPrice = Number(reconciledEntry.avgPrice);
  } else if (Number.isFinite(respAvg) && respAvg > 0) {
    execution.entryFill = respAvg;
    execution.entry = respAvg;
    execution.entryPrice = respAvg;
    execution.exchange.entryPriceSource = "order.avgPrice";
  } else {
    // 2) Fall back to positionRisk entryPrice (authoritative for the open position)
    try {
      const posEntry = await fetchFuturesPositionEntryPrice(
        execution.symbol,
        execution.direction
      );
      if (Number.isFinite(posEntry) && posEntry > 0) {
        execution.entryFill = posEntry;
        execution.entry = posEntry;
        execution.entryPrice = posEntry;
        execution.exchange.entryPriceSource = "positionRisk.entryPrice";
      } else {
        execution.exchange.entryPriceSource = "signal.entry";
      }
    } catch (e) {
      execution.exchange.entryPriceSource = "signal.entry";
    }
  }
  // Option 2: attach TP/SL directly on Binance Futures so we don't miss spikes between loop iterations.
  await attachFuturesTPSL(execution);

  return execution;
}

// Fetch the authoritative entryPrice from Binance Futures (positionRisk)
// so the bot state matches what Binance shows in the UI.
async function fetchFuturesPositionEntryPrice(symbol, direction) {
  const wantSide = String(direction).toUpperCase() === "SHORT" ? "SHORT" : "LONG";

  // node-binance-api naming differs across versions
  const fn =
    binance.futuresPositionRisk ||
    binance.futuresPositionInformation ||
    binance.futuresPositionInfo;

  if (typeof fn !== "function") return NaN;

  const positions = await fn.call(binance);
  if (!Array.isArray(positions)) return NaN;

  const pos = positions.find((p) => {
    if (!p) return false;
    if (String(p.symbol) !== String(symbol)) return false;

    // HEDGE mode returns separate LONG/SHORT legs
    if (FUTURES_POSITION_MODE === "HEDGE") {
      return String(p.positionSide).toUpperCase() === wantSide;
    }

    // ONE_WAY mode: positionSide may be BOTH (or missing)
    return true;
  });

  const entry = Number(pos?.entryPrice);
  return Number.isFinite(entry) ? entry : NaN;
}

async function reconcileOrderPhaseByRefs(execution, prefix, refs, fallbackExchangeReason) {
  const orderStatus = await fetchFuturesOrderStatus(execution.symbol, refs);
  const resolvedOrderId = refs?.orderId ?? orderStatus?.orderId ?? null;
  const userTradeFills = resolvedOrderId
    ? await fetchFuturesUserTradeFills(execution.symbol, {
        orderId: resolvedOrderId,
      })
    : [];

  const summary = reconcileExecutionOrderData(
    execution,
    prefix === "open" ? "open" : "close",
    orderStatus,
    userTradeFills
  );

  const fillCount = Array.isArray(userTradeFills) ? userTradeFills.length : 0;
  const filled =
    fillCount > 0 ||
    String(orderStatus?.status || "").toUpperCase() === "FILLED" ||
    Number(summary?.executedQty || 0) > 0;

  return {
    orderStatus,
    userTradeFills,
    summary,
    filled,
    closeReasonExchange: fallbackExchangeReason,
  };
}

async function reconcileClosedExecutionFromExchange(execution, closeReason, exitPriceRef = null) {
  const candidates = [];

  if (execution?.exchange?.closeOrderId || execution?.exchange?.closeClientOrderId) {
    candidates.push({
      refs: {
        orderId: execution.exchange.closeOrderId,
        clientOrderId: execution.exchange.closeClientOrderId,
      },
      closeReasonExchange: "market_close_order",
      internalCloseReason: closeReason,
      patch: {
        closeOrderId: execution.exchange.closeOrderId,
        closeClientOrderId: execution.exchange.closeClientOrderId,
      },
    });
  }

  for (const candidate of [
    {
      prefix: "sl",
      closeReasonExchange: "stop_market_filled",
      internalCloseReason: "SL",
    },
    {
      prefix: "tp",
      closeReasonExchange: "take_profit_market_filled",
      internalCloseReason: "TP",
    },
  ]) {
    const refs = getAttachedExitRefs(execution, candidate.prefix);
    if (!refs.orderId && !refs.clientOrderId) continue;
    candidates.push({
      refs,
      closeReasonExchange: candidate.closeReasonExchange,
      internalCloseReason: candidate.internalCloseReason,
      patch: {
        closeOrderId: refs.orderId,
        closeClientOrderId: refs.clientOrderId,
      },
    });
  }

  let best = null;

  for (const candidate of candidates) {
    const result = await reconcileOrderPhaseByRefs(
      execution,
      "close",
      candidate.refs,
      candidate.closeReasonExchange
    );

    if (!result.filled) continue;

    const closeTime = Number(
      result.summary?.lastFillTime ||
        result.orderStatus?.updateTime ||
        result.orderStatus?.time ||
        0
    );

    if (!best || closeTime >= Number(best.closeTime || 0)) {
      best = {
        ...result,
        closeTime,
        internalCloseReason: candidate.internalCloseReason,
        closeReasonExchange: candidate.closeReasonExchange,
        patch: candidate.patch,
      };
    }
  }

  if (!best) {
    return markExecutionClosed({
      execution,
      closeReason,
      exitPrice: Number(exitPriceRef || execution.entryFill || execution.entry),
      exitPlanned: exitPriceRef,
      logType: "futures_real_close_reconciled",
      exchangePatch: {
        closeReconciledFromExchange: true,
        closeReasonExchange: "position_reconciled_closed",
      },
    });
  }

  const exitPrice =
    Number.isFinite(Number(best.summary?.avgPrice)) && Number(best.summary.avgPrice) > 0
      ? Number(best.summary.avgPrice)
      : Number(exitPriceRef || execution.entryFill || execution.entry);

  return markExecutionClosed({
    execution,
    closeReason: best.internalCloseReason || closeReason,
    exitPrice,
    exitPlanned: exitPriceRef,
    logType: "futures_real_close_reconciled",
    exchangePatch: {
      ...best.patch,
      closeStatus: best.orderStatus?.status ?? execution.exchange?.closeStatus ?? null,
      closeExecutedQty:
        execution.exchange?.closeExecutedQty ??
        (Number.isFinite(Number(best.summary?.executedQty))
          ? String(best.summary.executedQty)
          : null),
      closeQuoteQty:
        execution.exchange?.closeQuoteQty ??
        (Number.isFinite(Number(best.summary?.quoteQty))
          ? String(best.summary.quoteQty)
          : null),
      closeTransactTime: best.closeTime || Date.now(),
      closeFills: best.userTradeFills,
      closeReconciledFromExchange: true,
      closeReasonExchange: best.closeReasonExchange,
    },
  });
}

async function closeRealFuturesPosition(execution, closeReason, exitPriceRef = null) {
  const closeSide = getCloseOrderSide(execution.direction);
  const qty = execution.quantity;

  if (FUTURES_ATTACH_TPSL_ON_ENTRY) {
    await cancelAllAttachedFuturesExits(execution);
  }

  let response;
  const common = {
    reduceOnly: true,
    positionSide:
      FUTURES_POSITION_MODE === "HEDGE"
        ? execution.direction === "LONG"
          ? "LONG"
          : "SHORT"
        : undefined,
  };

  if (closeSide === "BUY") {
    response = await binance.futuresMarketBuy(execution.symbol, qty, common);
  } else {
    response = await binance.futuresMarketSell(execution.symbol, qty, common);
  }

  execution.exchange.closeOrderId = response?.orderId ?? null;
  execution.exchange.closeClientOrderId = response?.clientOrderId ?? null;
  execution.exchange.closeStatus = response?.status ?? null;
  execution.exchange.closeExecutedQty = response?.executedQty ?? null;
  execution.exchange.closeQuoteQty = response?.cumQuote ?? null;
  execution.exchange.closeTransactTime = response?.updateTime ?? Date.now();
  execution.exchange.closeFills = response?.fills || [];

  const orderStatus = await fetchFuturesOrderStatus(execution.symbol, {
    orderId: execution.exchange.closeOrderId,
    clientOrderId: execution.exchange.closeClientOrderId,
  });
  const userTradeFills = await fetchFuturesUserTradeFills(execution.symbol, {
    orderId: execution.exchange.closeOrderId,
  });

  const reconciledExit = reconcileExecutionOrderData(
    execution,
    "close",
    orderStatus,
    userTradeFills
  );

  const exitPrice =
    Number(reconciledExit?.avgPrice) > 0
      ? Number(reconciledExit.avgPrice)
      : Number(response?.avgPrice) > 0
      ? Number(response.avgPrice)
      : Number(exitPriceRef || execution.entry);

  return markExecutionClosed({
    execution,
    closeReason,
    exitPrice,
    exitPlanned: exitPriceRef,
    logType: "futures_real_close",
    exchangePatch: {
      closeOrderId: execution.exchange.closeOrderId,
      closeClientOrderId: execution.exchange.closeClientOrderId,
      closeStatus: execution.exchange.closeStatus,
      closeExecutedQty: execution.exchange.closeExecutedQty,
      closeQuoteQty: execution.exchange.closeQuoteQty,
      closeTransactTime: execution.exchange.closeTransactTime,
      closeFills: execution.exchange.closeFills,
      closeReconciledFromExchange: false,
      closeReasonExchange: "market_close_order",
    },
  });
}

async function paperExecute(signalObj, state, options = {}) {
  const executionSignal = normalizeSignalForExecution(signalObj);
  const configuredAccountSize = Number(options.accountSize || ACCOUNT_SIZE);
  const riskPerTrade = Number(
    options.riskPerTrade || executionSignal.executionRiskPerTrade || FUTURES_RISK_PER_TRADE
  );
  const maxPositionUsd = Number(
    options.maxPositionUsd ||
      executionSignal.executionMaxPositionUsd ||
      FUTURES_MAX_POSITION_USDT
  );

  if (executionSignal?.invertedSignal) {
    console.log(
      `[FUTURES_EXECUTOR] ${executionSignal.symbol} sinal invertido ${executionSignal.originalDirection} -> ${executionSignal.direction}`
    );
  }

  const validation = validateSignalForFutures(executionSignal, state);
  if (!validation.ok) {
    return {
      executed: false,
      reason: validation.reason,
      order: null,
    };
  }

  const leverage = Number(options.leverage || FUTURES_DEFAULT_LEVERAGE);
  const quoteAsset = quoteAssetFromSymbol(executionSignal.symbol);
  const availableBalance =
    EXECUTION_MODE === "binance_real"
      ? await fetchAvailableFuturesBalance(quoteAsset)
      : null;
  const accountSizeDecision = resolveAccountSizeReference({
    configuredAccountSize,
    availableBalance,
  });
  const accountSize = Number(accountSizeDecision.accountSize);

  const approval = canExecute(executionSignal, state, {
    ...options,
    accountSize,
    riskPerTrade,
    maxPositionUsd,
  });
  if (!approval.ok) {
    return {
      executed: false,
      reason: approval.reason,
      order: null,
    };
  }

  let sizing = calcPositionSizeByRisk({
    accountSize,
    riskPerTrade,
    entry: executionSignal.entry,
    sl: executionSignal.sl,
    leverage,
  });

  if (!sizing) {
    return {
      executed: false,
      reason: "invalid_position_sizing",
      order: null,
    };
  }

  sizing = capSizingToBalance({
    sizing,
    entry: executionSignal.entry,
    leverage,
    availableBalance,
    maxPositionUsd,
  });

  if (!sizing) {
    return {
      executed: false,
      reason: "invalid_position_after_balance_cap",
      order: null,
    };
  }

  if (Number(sizing.positionNotional) < FUTURES_MIN_NOTIONAL_USDT) {
    return {
      executed: false,
      reason: "min_notional_not_reached",
      order: null,
    };
  }

  if (
    Number.isFinite(availableBalance) &&
    availableBalance > 0 &&
    Number(sizing.marginRequired) > availableBalance * FUTURES_BALANCE_BUFFER_PCT
  ) {
    return {
      executed: false,
      reason: "insufficient_available_balance_precheck",
      order: null,
    };
  }

  if (EXECUTION_MODE === "binance_real") {
    console.log(
      `[FUTURES_SIZING] ${executionSignal.symbol} available=${round(
        availableBalance,
        4
      )} accountRef=${round(
        accountSize,
        4
      )} accountSource=${accountSizeDecision.source} riskUsd=${round(
        sizing.riskUsd,
        4
      )} marginRequired=${round(
        sizing.marginRequired,
        4
      )} notional=${round(
        sizing.positionNotional,
        4
      )} leverage=${leverage}`
    );
  }

  let execution = buildBaseExecution(executionSignal, sizing, {
    leverage,
    riskPerTrade,
    accountSizeReference: accountSize,
    accountSizeSource: accountSizeDecision.source,
  });
  execution.entryFill = execution.entry;
  execution.entryPlanned = execution.entry;

  if (EXECUTION_MODE === "binance_real") {
    if (!hasRealTradeProtectionPathEnabled()) {
      return {
        executed: false,
        reason: "futures_protection_disabled",
        order: null,
      };
    }

    try {
      execution = await openRealFuturesPosition(execution);
      appendOrderLog({
        ts: execution.openedTs,
        type: "futures_real_open",
        symbol: execution.symbol,
        direction: execution.direction,
        quantity: execution.quantity,
        entryPrice: execution.entry,
        strategy: execution.strategy,
        linkedExecutionId: execution.id,
        ...buildExecutionAuditFields(execution),
        exchange: execution.exchange,
      });

      return {
        executed: true,
        reason: "futures_order_opened",
        order: execution,
      };
    } catch (err) {
      return {
        executed: false,
        reason: `futures_open_failed:${err.body?.msg || err.message || "unknown"}`,
        order: null,
      };
    }
  }

  appendOrderLog({
    ts: execution.openedTs,
    type: "futures_paper_open",
    symbol: execution.symbol,
    direction: execution.direction,
    quantity: execution.quantity,
    entryPrice: execution.entry,
    strategy: execution.strategy,
    linkedExecutionId: execution.id,
    ...buildExecutionAuditFields(execution),
  });

  return {
    executed: true,
    reason: "paper_futures_opened",
    order: execution,
  };
}

async function closeExecutionForSignal(state, signal) {
  const executions = Array.isArray(state.executions) ? state.executions : [];
  const execution =
    executions.find(
      (e) => signal.executionOrderId && e.id === signal.executionOrderId
    ) ||
    executions.find(
      (e) =>
        e.symbol === signal.symbol &&
        e.tf === signal.tf &&
        e.status === "OPEN" &&
        e.direction === signal.direction
    );

  if (!execution) return null;

  const closeReason = signal.outcome || signal.closeReason || "MANUAL_CLOSE";
  const exitPriceRef =
    closeReason === "TP"
      ? Number(signal.exitRef || execution.tp || signal.tp)
      : closeReason === "SL"
      ? Number(signal.exitRef || execution.sl || signal.sl)
      : Number(signal.exitRef || execution.entry);

  if (EXECUTION_MODE === "binance_real") {
    try {
      const stillOpenOnExchange = await isExecutionStillOpenOnExchange(execution);
      if (!stillOpenOnExchange) {
        return await reconcileClosedExecutionFromExchange(
          execution,
          closeReason,
          exitPriceRef
        );
      }

      const closed = await closeRealFuturesPosition(execution, closeReason, exitPriceRef);
      return closed;
    } catch (err) {
      throw err;
    }
  }

  return markExecutionClosed({
    execution,
    closeReason,
    exitPrice: exitPriceRef,
    exitPlanned: exitPriceRef,
    logType: "futures_paper_close",
  });
}


async function fetchFuturesReferencePrice(symbol) {
  try {
    if (typeof binance.futuresMarkPrice === "function") {
      const mp = await binance.futuresMarkPrice(symbol);
      const price =
        Number(mp?.markPrice) ||
        Number(mp?.price) ||
        Number(mp?.[symbol]?.markPrice) ||
        Number(mp?.[symbol]?.price);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch {}

  try {
    if (typeof binance.futuresPrices === "function") {
      const prices = await binance.futuresPrices();
      const price = Number(prices?.[symbol]);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch {}

  return null;
}

async function forceCloseExecutionById(state, executionId) {
  const executions = Array.isArray(state?.executions) ? state.executions : [];
  const execution = executions.find(
    (e) => e && e.id === executionId && e.status === "OPEN"
  );

  if (!execution) {
    return {
      ok: false,
      error: "execution_not_found_or_not_open",
    };
  }

  const exitPriceRef =
    (await fetchFuturesReferencePrice(execution.symbol)) ||
    Number(execution.entry);

  let closed;
  if (EXECUTION_MODE === "binance_real") {
    closed = await closeRealFuturesPosition(
      execution,
      "MANUAL_MARKET_CLOSE",
      exitPriceRef
    );
  } else {
    closed = markExecutionClosed({
      execution,
      closeReason: "MANUAL_MARKET_CLOSE",
      exitPrice: Number(exitPriceRef),
      exitPlanned: Number(exitPriceRef),
      logType: "futures_paper_close",
    });
  }

  return {
    ok: true,
    executionId: closed.id,
    symbol: closed.symbol,
    direction: closed.direction,
    exitPrice: closed.exitPrice,
    pnlPct: closed.pnlPct,
    pnlUsd: closed.pnlUsd,
    closeReason: closed.closeReason,
  };
}

module.exports = {
  paperExecute,
  closeExecutionForSignal,
  forceCloseExecutionById,
  fetchFuturesReferencePrice,
  moveExecutionStopToBreakEven,
  calcPnlPct,
  calcPnlUsd,
  calcPositionSizeByRisk,
  capSizingToBalance,
  resolveAccountSizeReference,
};
