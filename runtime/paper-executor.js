require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const Binance = require("node-binance-api");
const { canExecute } = require("./risk-manager");
const {
  appendJsonArray,
  readJsonSafe,
  writeJsonAtomic,
} = require("./file-utils");

const ORDERS_LOG_FILE =
  process.env.ORDERS_LOG_FILE_PATH || path.join(__dirname, "orders-log.json");
const METRICS_FILE =
  process.env.EXECUTION_METRICS_FILE_PATH ||
  path.join(__dirname, "execution-metrics.json");
const ADAPTIVE_CONFIG_FILE = path.join(__dirname, "runtime", "adaptive-config.json");

const ACCOUNT_SIZE = Number(process.env.ACCOUNT_SIZE || 1000);
const RISK_PER_TRADE = Number(process.env.RISK_PER_TRADE || 0.01);
const MAX_POSITION_USD = Number(process.env.MAX_POSITION_USD || 200);

const MIN_TRADE_USDC = Number(process.env.MIN_TRADE_USDC || 6);
const TRADE_PERCENT_OF_FREE = Number(process.env.TRADE_PERCENT_OF_FREE || 0.10);
const MAX_TRADE_PERCENT_OF_FREE = Number(process.env.MAX_TRADE_PERCENT_OF_FREE || 0.95);

const EXECUTION_MODE = String(process.env.EXECUTION_MODE || "paper").toLowerCase();
const BINANCE_REAL_ORDERS = String(process.env.BINANCE_REAL_ORDERS || "0") === "1";
const BINANCE_USE_TEST_ORDER = String(process.env.BINANCE_USE_TEST_ORDER || "1") === "1";

const MAX_SLIPPAGE_PCT = Number(process.env.MAX_SLIPPAGE_PCT || 0.002);
const COMMISSION_RATE = Number(process.env.COMMISSION_RATE || 0.002);

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
});

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  useServerTime: true,
  recvWindow: Number(process.env.BINANCE_RECV_WINDOW || 60000),
  test: false,
  // @ts-ignore
  httpsAgent: keepAliveAgent,
});

const filtersCache = new Map();

/* -------------------- adaptive config -------------------- */

function loadAdaptiveConfig() {
  return readJsonSafe(ADAPTIVE_CONFIG_FILE, { symbols: {}, global: {} });
}

/* -------------------- retry -------------------- */

async function withRetry(fn, label, tries = 5) {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt >= tries) throw e;

      const sleep = Math.min(3000 * attempt, 10000);

      console.log(
        `[RETRY] ${label} falhou (${attempt}/${tries}) -> retry em ${sleep}ms :: ${e.body || e.message}`
      );

      await new Promise((r) => setTimeout(r, sleep));
    }
  }
}

/* -------------------- logs -------------------- */

function loadOrdersLog() {
  return readJsonSafe(ORDERS_LOG_FILE, []);
}

function saveOrdersLog(log) {
  writeJsonAtomic(ORDERS_LOG_FILE, log);
}

function appendOrderLog(order) {
  const log = appendJsonArray(ORDERS_LOG_FILE, order);
  if (log.length > 10000) {
    saveOrdersLog(log.slice(-10000));
  }
}

/* -------------------- metrics -------------------- */

function loadMetrics() {
  return readJsonSafe(METRICS_FILE, []);
}

function saveMetrics(metrics) {
  writeJsonAtomic(METRICS_FILE, metrics);
}

function recordExecutionMetric(metric) {
  const metrics = appendJsonArray(METRICS_FILE, metric);
  if (metrics.length > 5000) {
    saveMetrics(metrics.slice(-5000));
  }
}

function computeAdaptiveSlippage(symbol = null) {
  const metrics = loadMetrics();

  const filtered = symbol
    ? metrics.filter((m) => m.symbol === symbol)
    : metrics;

  if (filtered.length < 20) {
    return MAX_SLIPPAGE_PCT;
  }

  const values = filtered
    .map((m) => m.slippagePct)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  if (!values.length) {
    return MAX_SLIPPAGE_PCT;
  }

  const p95 = values[Math.floor(values.length * 0.95)] ?? MAX_SLIPPAGE_PCT;
  return Math.max(p95 * 1.5, MAX_SLIPPAGE_PCT);
}

/* -------------------- helpers -------------------- */

function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(decimals));
}

function roundToStep(qty, step) {
  return Math.floor(qty / step) * step;
}

function roundToTick(price, tick) {
  return Math.round(price / tick) * tick;
}

function getQuoteAsset(symbol) {
  if (symbol.endsWith("USDC")) return "USDC";
  if (symbol.endsWith("USDT")) return "USDT";
  if (symbol.endsWith("BUSD")) return "BUSD";
  return null;
}

function getBaseAsset(symbol) {
  const quote = getQuoteAsset(symbol);
  if (!quote) return symbol;
  return symbol.replace(quote, "");
}

function getNetBaseQtyFromFills(fills, executedQty, symbol) {
  const baseAsset = getBaseAsset(symbol);
  const grossQty = Number(executedQty || 0);

  if (!Array.isArray(fills) || !fills.length) {
    return grossQty;
  }

  let baseCommission = 0;

  for (const fill of fills) {
    if (fill.commissionAsset === baseAsset) {
      baseCommission += Number(fill.commission || 0);
    }
  }

  const netQty = grossQty - baseCommission;
  return netQty > 0 ? netQty : grossQty;
}

async function getMarketPrice(symbol) {
  const ticker = await withRetry(() => binance.prices(symbol), `ticker ${symbol}`);
  const price = Number(ticker[symbol]);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`ticker inválido para ${symbol}`);
  }

  return price;
}

/* -------------------- balances -------------------- */

async function getBalances() {
  return await withRetry(() => binance.balance(), "balance");
}

async function getFreeAsset(asset) {
  const balances = await getBalances();
  const b = balances[asset];
  return b ? Number(b.available) : 0;
}

/* -------------------- filters -------------------- */

async function initFilters(symbol) {
  if (filtersCache.has(symbol)) {
    return filtersCache.get(symbol);
  }

  const info = await withRetry(() => binance.exchangeInfo(), "exchangeInfo");
  const sym = info.symbols.find((s) => s.symbol === symbol);

  if (!sym) {
    throw new Error(`Símbolo ${symbol} não encontrado em exchangeInfo`);
  }

  const pf = sym.filters.find((f) => f.filterType === "PRICE_FILTER");

  let lf = sym.filters.find((f) => f.filterType === "MARKET_LOT_SIZE");
  if (!lf || !Number.isFinite(parseFloat(lf.stepSize)) || parseFloat(lf.stepSize) <= 0) {
    lf = sym.filters.find((f) => f.filterType === "LOT_SIZE");
  }

  if (!pf || !lf) {
    throw new Error(`Filtros PRICE_FILTER / LOT_SIZE ausentes para ${symbol}`);
  }

  const minNotionalFilter = sym.filters.find((f) => f.filterType === "MIN_NOTIONAL");
  const notionalFilter = sym.filters.find((f) => f.filterType === "NOTIONAL");

  let minNotional = 0;

  if (minNotionalFilter?.minNotional) {
    minNotional = parseFloat(minNotionalFilter.minNotional);
  } else if (notionalFilter?.minNotional) {
    minNotional = parseFloat(notionalFilter.minNotional);
  }

  const filters = {
    tickSize: parseFloat(pf.tickSize),
    stepSize: parseFloat(lf.stepSize),
    minQty: parseFloat(lf.minQty || 0),
    minNotional,
  };

  filtersCache.set(symbol, filters);

  console.log(
    `[FILTERS] ${symbol} tickSize=${filters.tickSize} stepSize=${filters.stepSize} minQty=${filters.minQty} minNotional=${filters.minNotional}`
  );

  return filters;
}

function adjustQtyAndPrice(price, qty, filters) {
  const safePrice = parseFloat(
    roundToTick(price, filters.tickSize).toFixed(8)
  );

  let safeQty = roundToStep(qty, filters.stepSize);

  if (safeQty < filters.minQty) {
    safeQty = filters.minQty;
  }

  if (filters.minNotional > 0) {
    const notional = safePrice * safeQty;

    if (notional < filters.minNotional) {
      const requiredQty =
        Math.ceil((filters.minNotional / safePrice) / filters.stepSize) *
        filters.stepSize;

      safeQty = requiredQty;
    }
  }

  return {
    price: safePrice,
    qty: parseFloat(safeQty.toFixed(8)),
  };
}

/* -------------------- slippage -------------------- */

async function checkSlippage(symbol, entry) {
  const ticker = await withRetry(() => binance.prices(symbol), `ticker ${symbol}`);
  const price = Number(ticker[symbol]);
  const diff = Math.abs(price - entry) / entry;

  const adaptiveConfig = loadAdaptiveConfig();
  const adaptiveSymbol = adaptiveConfig?.symbols?.[symbol];
  const adaptiveGlobal = adaptiveConfig?.global || {};

  const allowed =
    adaptiveSymbol?.maxAllowedSlippagePct ??
    adaptiveGlobal?.maxAllowedSlippagePct ??
    computeAdaptiveSlippage(symbol);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`ticker inválido para ${symbol}`);
  }

  if (diff > allowed) {
    throw new Error(`slippage too high ${diff} allowed ${allowed}`);
  }

  return price;
}

/* -------------------- sizing -------------------- */

function calculatePositionSize(entry, sl) {
  const riskAmount = ACCOUNT_SIZE * RISK_PER_TRADE;
  const stopDistance = Math.abs(entry - sl);

  if (!Number.isFinite(entry) || !Number.isFinite(sl) || stopDistance <= 0) {
    return {
      quantity: 0,
      riskAmount,
      stopDistance: 0,
      positionUsd: 0,
    };
  }

  let quantity = riskAmount / stopDistance;
  let positionUsd = quantity * entry;

  if (positionUsd > MAX_POSITION_USD) {
    quantity = MAX_POSITION_USD / entry;
    positionUsd = quantity * entry;
  }

  if (quantity > 1e7) {
    quantity = 1e7;
    positionUsd = quantity * entry;
  }

  return {
    quantity: round(quantity, 6),
    riskAmount: round(riskAmount, 2),
    stopDistance: round(stopDistance, 8),
    positionUsd: round(positionUsd, 2),
  };
}

/* -------------------- POSITION SIZE REVERTIDO -------------------- */

function calculatePositionSizeFromBalance(entry, freeQuote) {
  if (!Number.isFinite(entry) || entry <= 0) {
    return {
      quantity: 0,
      positionUsd: 0,
      freeQuote: round(freeQuote || 0, 2),
      tradeUsd: 0,
    };
  }

  const safeFreeQuote = Number.isFinite(freeQuote) ? freeQuote : 0;

  if (safeFreeQuote < MIN_TRADE_USDC) {
    return {
      quantity: 0,
      positionUsd: 0,
      freeQuote: round(safeFreeQuote, 2),
      tradeUsd: 0,
    };
  }

  let tradeUsd = safeFreeQuote * TRADE_PERCENT_OF_FREE;

  if (tradeUsd < MIN_TRADE_USDC) {
    tradeUsd = MIN_TRADE_USDC;
  }

  const maxAllowedUsd = safeFreeQuote * MAX_TRADE_PERCENT_OF_FREE;
  tradeUsd = Math.min(tradeUsd, maxAllowedUsd);

  if (Number.isFinite(MAX_POSITION_USD) && MAX_POSITION_USD > 0) {
    tradeUsd = Math.min(tradeUsd, MAX_POSITION_USD);
  }

  if (tradeUsd <= 0) {
    return {
      quantity: 0,
      positionUsd: 0,
      freeQuote: round(safeFreeQuote, 2),
      tradeUsd: 0,
    };
  }

  const quantity = tradeUsd / entry;

  return {
    quantity: round(quantity, 6),
    positionUsd: round(tradeUsd, 2),
    freeQuote: round(safeFreeQuote, 2),
    tradeUsd: round(tradeUsd, 2),
  };
}

/* -------------------- execution object -------------------- */

function buildExecution(signalObj, options = {}) {
  const { mode = "paper", exchange = null, sizing = null } = options;
  const fallbackSizing = calculatePositionSize(signalObj.entry, signalObj.sl);
  const effectiveSizing = sizing || fallbackSizing;

  return {
  id: `${mode}_${Date.now()}_${signalObj.symbol}`,
  ts: Date.now(),
  signalTs: signalObj.ts,
  mode,
  status: "OPEN",
  symbol: signalObj.symbol,
  tf: signalObj.tf,
  strategy: signalObj.strategy || "unknown",
  side: signalObj.side,
  entry: signalObj.entry,
  sl: signalObj.sl,
  tp: signalObj.tp,
  score: signalObj.score,
  signalClass: signalObj.signalClass,
  quantity: effectiveSizing.quantity,
  riskAmount: effectiveSizing.riskAmount ?? null,
  stopDistance: effectiveSizing.stopDistance ?? null,
  positionUsd: effectiveSizing.positionUsd ?? 0,
  tradeUsd: effectiveSizing.tradeUsd ?? effectiveSizing.positionUsd ?? 0,
  freeQuote: effectiveSizing.freeQuote ?? null,
  source: mode === "paper" ? "paper-executor" : "binance-spot",
  isTrend: signalObj.isTrend ?? null,
  isRange: signalObj.isRange ?? null,
  adx: signalObj.adx ?? null,
  atr: signalObj.atr ?? null,
  rrPlanned: signalObj.rrPlanned ?? null,
  closedTs: null,
  closeReason: null,
  exitPrice: null,
  pnlPct: null,
  commissionRate: COMMISSION_RATE,
  outcome: null,
  exchange: exchange || null,
  };
}

function buildPaperOrder(signalObj, reason = "paper_order_opened", extra = {}) {
  const sizing = extra.sizing || calculatePositionSize(signalObj.entry, signalObj.sl);

  const order = buildExecution(signalObj, {
    mode: "paper",
    exchange: extra.exchange || null,
    sizing,
  });

  if (!order.quantity || order.quantity <= 0) {
    return {
      ok: false,
      executed: false,
      reason: "invalid_quantity",
    };
  }

  appendOrderLog(order);

  return {
    ok: true,
    executed: true,
    reason,
    order,
  };
}

/* -------------------- buy -------------------- */

async function placeRealMarketBuy(signalObj) {
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    throw new Error("BINANCE_API_KEY / BINANCE_API_SECRET em falta");
  }

  const adaptiveConfig = loadAdaptiveConfig();
  const adaptiveSymbol = adaptiveConfig?.symbols?.[signalObj.symbol];
  const adaptiveGlobal = adaptiveConfig?.global || {};

  const signalTs = Date.now();
  const filters = await initFilters(signalObj.symbol);

  const quoteAsset = getQuoteAsset(signalObj.symbol);
  let freeQuote = 0;

  if (quoteAsset) {
    freeQuote = await getFreeAsset(quoteAsset);
  }

  const sizing = calculatePositionSizeFromBalance(signalObj.entry, freeQuote);

  if (!sizing.quantity || sizing.quantity <= 0) {
    throw new Error(
      `Saldo insuficiente para trade mínima: free=${round(freeQuote, 4)} ${quoteAsset || "QUOTE"}`
    );
  }

  const marketPrice = await checkSlippage(signalObj.symbol, signalObj.entry);
  const adjusted = adjustQtyAndPrice(marketPrice, sizing.quantity, filters);

  console.log(
    `[ORDER_PREP] ${signalObj.symbol} entry=${signalObj.entry} market=${marketPrice} rawQty=${sizing.quantity} adjQty=${adjusted.qty} adjPrice=${adjusted.price} mode=${EXECUTION_MODE}`
  );

  if (!adjusted.qty || adjusted.qty <= 0) {
    throw new Error("invalid_quantity_after_filters");
  }

  if (quoteAsset) {
    const estimatedCost = adjusted.qty * adjusted.price;

    console.log(
      `[BALANCE_CHECK] ${signalObj.symbol} free=${freeQuote.toFixed(4)} ${quoteAsset} need=${estimatedCost.toFixed(4)}`
    );

    if (estimatedCost > freeQuote) {
      throw new Error(
        `Saldo insuficiente após ajuste aos filtros: preciso ~${estimatedCost.toFixed(4)} ${quoteAsset} e tenho ${freeQuote.toFixed(4)}`
      );
    }
  }

  const orderSentTs = Date.now();

  if (EXECUTION_MODE === "binance_test" && BINANCE_USE_TEST_ORDER) {
    const testOrderFn =
      typeof binance.testOrder === "function"
        ? () =>
            binance.testOrder({
              symbol: signalObj.symbol,
              side: "BUY",
              type: "MARKET",
              quantity: adjusted.qty,
            })
        : typeof binance.orderTest === "function"
        ? () =>
            binance.orderTest("BUY", signalObj.symbol, adjusted.qty, false, {
              type: "MARKET",
            })
        : null;

    if (!testOrderFn) {
      throw new Error("binance test order function not available");
    }

    await withRetry(
      testOrderFn,
      `testOrder BUY ${signalObj.symbol}`
    );

    const order = buildExecution(signalObj, {
      mode: "binance_test",
      sizing: {
        quantity: adjusted.qty,
        positionUsd: round(adjusted.qty * adjusted.price, 2),
        tradeUsd: round(adjusted.qty * adjusted.price, 2),
        freeQuote: round(freeQuote, 2),
      },
      exchange: {
        test: true,
        side: "BUY",
        type: "MARKET",
        requestedQty: adjusted.qty,
      },
    });

    return {
      mode: "binance_test",
      order,
    };
  }

  if (!BINANCE_REAL_ORDERS) {
    throw new Error("BINANCE_REAL_ORDERS=0 bloqueia trading real");
  }

  const data = await withRetry(
    () => binance.marketBuy(signalObj.symbol, adjusted.qty),
    `marketBuy ${signalObj.symbol}`
  );

  const fillTs = Date.now();
  const grossExecutedQty = Number(data.executedQty || adjusted.qty);
  const netExecutedQty = getNetBaseQtyFromFills(
    data.fills ?? [],
    grossExecutedQty,
    signalObj.symbol
  );

  const quoteQty = Number(
    data.cummulativeQuoteQty || grossExecutedQty * adjusted.price
  );

  const avgEntryPrice =
    grossExecutedQty > 0 ? quoteQty / grossExecutedQty : Number(signalObj.entry);

  const latencyInternal = orderSentTs - signalTs;
  const latencyExchange = fillTs - orderSentTs;
  const latencyTotal = fillTs - signalTs;
  const slippagePct = Math.abs(avgEntryPrice - signalObj.entry) / signalObj.entry;

  const maxAllowedLatencyMs =
    adaptiveSymbol?.maxAllowedLatencyMs ??
    adaptiveGlobal?.maxAllowedLatencyMs ??
    null;

  if (
    Number.isFinite(maxAllowedLatencyMs) &&
    latencyTotal > Number(maxAllowedLatencyMs)
  ) {
    throw new Error(`latency too high ${latencyTotal} allowed ${maxAllowedLatencyMs}`);
  }

  console.log(
    `[LATENCY] ${signalObj.symbol} internal=${latencyInternal}ms exchange=${latencyExchange}ms total=${latencyTotal}ms slippage=${(slippagePct * 100).toFixed(3)}%`
  );

  recordExecutionMetric({
    ts: fillTs,
    symbol: signalObj.symbol,
    entrySignal: signalObj.entry,
    entryFill: avgEntryPrice,
    slippagePct,
    latencyInternal,
    latencyExchange,
    latencyTotal,
  });

  const order = buildExecution(signalObj, {
    mode: "binance_real",
    sizing: {
      quantity: round(netExecutedQty, 8),
      grossQuantity: round(grossExecutedQty, 8),
      positionUsd: round(quoteQty, 2),
      tradeUsd: round(quoteQty, 2),
      freeQuote: round(freeQuote, 2),
    },
    exchange: {
      test: false,
      entryOrderId: data.orderId ?? null,
      entryClientOrderId: data.clientOrderId ?? null,
      entryTransactTime: data.transactTime ?? null,
      entryStatus: data.status ?? null,
      entryExecutedQty: data.executedQty ?? null,
      entryNetExecutedQty: round(netExecutedQty, 8),
      entryQuoteQty: data.cummulativeQuoteQty ?? null,
      entryFills: data.fills ?? [],
    },
  });

  order.quantity = round(netExecutedQty, 8);
  order.grossQuantity = round(grossExecutedQty, 8);
  order.positionUsd = round(quoteQty, 2);
  order.tradeUsd = round(quoteQty, 2);
  order.freeQuote = round(freeQuote, 2);
  order.entry = round(avgEntryPrice, 8);

  return {
    mode: "binance_real",
    order,
  };
}

/* -------------------- manual close by id -------------------- */

async function forceCloseExecutionById(state, executionId) {
  if (!state || !Array.isArray(state.executions)) {
    return { ok: false, reason: "invalid_state" };
  }

  const exec = state.executions.find(
    (e) => String(e.id) === String(executionId)
  );

  if (!exec) {
    return { ok: false, reason: "execution_not_found" };
  }

  if (exec.status !== "OPEN") {
    return { ok: false, reason: "execution_not_open" };
  }

  if (exec.mode === "paper" || exec.mode === "binance_test") {
    const price = await getMarketPrice(exec.symbol);

    exec.status = "CLOSED";
    exec.closedTs = Date.now();
    exec.closeReason = "MANUAL_MARKET_SELL";
    exec.outcome = "MANUAL_MARKET_SELL";
    exec.exitPrice = round(price, 8);

    exec.pnlPct =
      Number.isFinite(exec.entry) && exec.entry > 0
        ? ((exec.exitPrice - exec.entry) / exec.entry) * 100
        : 0;

    appendOrderLog({
      ts: Date.now(),
      type: "manual_sell_close",
      symbol: exec.symbol,
      side: "SELL",
      quantity: Number(exec.quantity || 0),
      exitPrice: exec.exitPrice,
      pnlPct: exec.pnlPct,
      closeReason: exec.closeReason,
      linkedExecutionId: exec.id,
      mode: exec.mode,
    });

    if (Array.isArray(state.openSignals)) {
      state.openSignals = state.openSignals.filter(
        (s) => !(s.symbol === exec.symbol && s.tf === exec.tf && s.ts === exec.signalTs)
      );
    }

    return {
      ok: true,
      reason: "manual_close_done",
      executionId: exec.id,
      symbol: exec.symbol,
      exitPrice: exec.exitPrice,
      pnlPct: exec.pnlPct,
      mode: exec.mode,
    };
  }

  const baseAsset = getBaseAsset(exec.symbol);
  const freeBase = await getFreeAsset(baseAsset);

  let sellQty = Math.min(Number(exec.quantity || 0), freeBase);

  const filters = await initFilters(exec.symbol);
  sellQty = roundToStep(sellQty, filters.stepSize);
  sellQty = parseFloat(sellQty.toFixed(8));

  if (!sellQty || sellQty <= 0) {
    throw new Error(
      `Sem saldo disponível para fechar ${exec.symbol}: free=${freeBase}, qty=${exec.quantity}`
    );
  }

  const sellData = await withRetry(
    () => binance.marketSell(exec.symbol, sellQty),
    `manual marketSell ${exec.symbol}`
  );

  const soldQty = Number(sellData.executedQty || sellQty);
  const quoteQty = Number(sellData.cummulativeQuoteQty || 0);
  const avgExitPrice =
    soldQty > 0 && quoteQty > 0 ? quoteQty / soldQty : Number(exec.entry);
  const residualQty = Math.max(0, Number(exec.quantity || 0) - soldQty);

  exec.status = "CLOSED";
  exec.closedTs = Date.now();
  exec.closeReason = "MANUAL_MARKET_SELL";
  exec.outcome = "MANUAL_MARKET_SELL";
  exec.exitPrice = round(avgExitPrice, 8);

  exec.pnlPct =
    Number.isFinite(exec.entry) && exec.entry > 0
      ? ((exec.exitPrice - exec.entry) / exec.entry) * 100
      : 0;

  exec.exchange = {
    ...(exec.exchange || {}),
    exitOrderId: sellData.orderId ?? null,
    exitClientOrderId: sellData.clientOrderId ?? null,
    exitTransactTime: sellData.transactTime ?? null,
    exitStatus: sellData.status ?? null,
    exitExecutedQty: sellData.executedQty ?? null,
    exitQuoteQty: sellData.cummulativeQuoteQty ?? null,
    exitFills: sellData.fills ?? [],
    exitResidualQty: round(residualQty, 8),
    exitFreeBaseAtClose: round(freeBase, 8),
  };

  appendOrderLog({
    ts: Date.now(),
    type: "manual_sell_close",
    symbol: exec.symbol,
    side: "SELL",
    quantity: soldQty,
    exitPrice: exec.exitPrice,
    pnlPct: exec.pnlPct,
    closeReason: exec.closeReason,
    linkedExecutionId: exec.id,
    exchange: exec.exchange,
  });

  if (Array.isArray(state.openSignals)) {
    state.openSignals = state.openSignals.filter(
      (s) => !(s.symbol === exec.symbol && s.tf === exec.tf && s.ts === exec.signalTs)
    );
  }

  return {
    ok: true,
    reason: "manual_close_done",
    executionId: exec.id,
    symbol: exec.symbol,
    exitPrice: exec.exitPrice,
    pnlPct: exec.pnlPct,
    mode: exec.mode,
  };
}

/* -------------------- close -------------------- */

async function closeExecutionForSignal(state, closedSignal) {
  if (!Array.isArray(state.executions)) return null;

  const exec = state.executions.find(
    (e) =>
      e.status === "OPEN" &&
      e.symbol === closedSignal.symbol &&
      e.tf === closedSignal.tf &&
      e.signalTs === closedSignal.ts
  );

  if (!exec) {
    console.log(
      `[EXECUTOR_CLOSE] execução não encontrada para ${closedSignal.symbol} tf=${closedSignal.tf} ts=${closedSignal.ts}`
    );
    return null;
  }

  if (exec.mode === "paper") {
    exec.status = "CLOSED";
    exec.closedTs = closedSignal.closedTs || Date.now();
    exec.closeReason = closedSignal.outcome || null;
    exec.outcome = closedSignal.outcome || null;
    exec.exitPrice =
      closedSignal.outcome === "TP"
        ? Number(closedSignal.tp)
        : closedSignal.outcome === "SL"
        ? Number(closedSignal.sl)
        : Number(closedSignal.exitRef || 0);

    exec.pnlPct =
      Number.isFinite(exec.entry) &&
      exec.entry > 0 &&
      Number.isFinite(exec.exitPrice)
        ? ((exec.exitPrice - exec.entry) / exec.entry) * 100
        : Number(closedSignal.pnlPct || 0);

    return exec;
  }

  if (exec.mode === "binance_test") {
    exec.status = "CLOSED";
    exec.closedTs = closedSignal.closedTs || Date.now();
    exec.closeReason = closedSignal.outcome || null;
    exec.outcome = closedSignal.outcome || null;
    exec.exitPrice =
      closedSignal.outcome === "TP"
        ? Number(closedSignal.tp)
        : closedSignal.outcome === "SL"
        ? Number(closedSignal.sl)
        : Number(closedSignal.exitRef || 0);

    exec.pnlPct =
      Number.isFinite(exec.entry) &&
      exec.entry > 0 &&
      Number.isFinite(exec.exitPrice)
        ? ((exec.exitPrice - exec.entry) / exec.entry) * 100
        : Number(closedSignal.pnlPct || 0);

    exec.exchange = {
      ...(exec.exchange || {}),
      exitTest: true,
    };

    return exec;
  }

  const baseAsset = getBaseAsset(exec.symbol);
  const freeBase = await getFreeAsset(baseAsset);

  let sellQty = Math.min(Number(exec.quantity || 0), freeBase);

  const filters = await initFilters(exec.symbol);
  sellQty = roundToStep(sellQty, filters.stepSize);
  sellQty = parseFloat(sellQty.toFixed(8));

  if (!sellQty || sellQty <= 0) {
    throw new Error(
      `Sem saldo disponível para fechar ${exec.symbol}: free=${freeBase}, qty=${exec.quantity}`
    );
  }

  const sellData = await withRetry(
    () => binance.marketSell(exec.symbol, sellQty),
    `marketSell ${exec.symbol}`
  );

  const soldQty = Number(sellData.executedQty || sellQty);
  const quoteQty = Number(sellData.cummulativeQuoteQty || 0);
  const avgExitPrice =
    soldQty > 0 && quoteQty > 0 ? quoteQty / soldQty : Number(exec.entry);
  const residualQty = Math.max(0, Number(exec.quantity || 0) - soldQty);

  exec.status = "CLOSED";
  exec.closedTs = closedSignal.closedTs || Date.now();
  exec.closeReason = closedSignal.outcome || null;
  exec.outcome = closedSignal.outcome || null;
  exec.exitPrice = round(avgExitPrice, 8);

  exec.pnlPct =
    Number.isFinite(exec.entry) && exec.entry > 0
      ? ((exec.exitPrice - exec.entry) / exec.entry) * 100
      : 0;

  exec.exchange = {
    ...(exec.exchange || {}),
    exitOrderId: sellData.orderId ?? null,
    exitClientOrderId: sellData.clientOrderId ?? null,
    exitTransactTime: sellData.transactTime ?? null,
    exitStatus: sellData.status ?? null,
    exitExecutedQty: sellData.executedQty ?? null,
    exitQuoteQty: sellData.cummulativeQuoteQty ?? null,
    exitFills: sellData.fills ?? [],
    exitResidualQty: round(residualQty, 8),
    exitFreeBaseAtClose: round(freeBase, 8),
  };

  appendOrderLog({
    ts: Date.now(),
    type: "real_sell_close",
    symbol: exec.symbol,
    side: "SELL",
    quantity: soldQty,
    exitPrice: exec.exitPrice,
    pnlPct: exec.pnlPct,
    closeReason: exec.closeReason,
    linkedExecutionId: exec.id,
    exchange: exec.exchange,
  });

  return exec;
}

/* -------------------- main executor -------------------- */

async function paperExecute(signalObj, state, options = {}) {
  const adaptiveConfig = loadAdaptiveConfig();
  const adaptiveSymbol = adaptiveConfig?.symbols?.[signalObj.symbol];

  if (adaptiveSymbol?.enabled === false) {
    return {
      ok: false,
      executed: false,
      reason: "adaptive_symbol_disabled",
    };
  }

  const defaults = {
    minScore: 70,
    allowedClasses: ["EXECUTABLE"],
    maxOpenTradesTotal: 3,
    maxOpenTradesPerSymbol: 1,
    allowedSymbols: [],
  };

  const cfg = { ...defaults, ...options };
  const approval = canExecute(signalObj, state, cfg);

  if (!approval.ok) {
    return {
      ok: false,
      executed: false,
      reason: approval.reason,
    };
  }

  if (EXECUTION_MODE === "paper") {
    return buildPaperOrder(signalObj, "paper_order_opened");
  }

  try {
    const result = await placeRealMarketBuy(signalObj);
    appendOrderLog(result.order);

    return {
      ok: true,
      executed: true,
      reason:
        result.mode === "binance_real"
          ? "binance_order_opened"
          : "binance_test_ok",
      order: result.order,
      mode: result.mode,
    };
  } catch (err) {
    const rawReason = err.body || err.message || "binance_order_failed";

    console.log(
      `[EXECUTION_ERROR] ${signalObj.symbol} mode=${EXECUTION_MODE} reason=${rawReason}`
    );

    return {
      ok: false,
      executed: false,
      reason: rawReason,
    };
  }
}

module.exports = {
  paperExecute,
  closeExecutionForSignal,
  forceCloseExecutionById,
};
