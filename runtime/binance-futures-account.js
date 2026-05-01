require("dotenv").config();

const Binance = require("node-binance-api");

const BINANCE_RECV_WINDOW = Number(process.env.BINANCE_RECV_WINDOW || 5000);
const FUTURES_QUOTE_ASSET = String(process.env.FUTURES_QUOTE_ASSET || "USDT").toUpperCase();

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  recvWindow: BINANCE_RECV_WINDOW,
  useServerTime: true,
  test: false,
});

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBalanceRow(row = {}) {
  const walletBalance = toNumber(row.walletBalance ?? row.balance ?? row.crossWalletBalance);
  const availableBalance = toNumber(
    row.availableBalance ?? row.available ?? row.maxWithdrawAmount ?? walletBalance
  );
  const marginBalance = toNumber(
    row.marginBalance ?? row.balance ?? row.crossWalletBalance ?? walletBalance
  );

  return {
    asset: String(row.asset || "").toUpperCase(),
    walletBalance,
    availableBalance,
    marginBalance,
    unrealizedProfit: toNumber(row.unrealizedProfit),
  };
}

function normalizePositionRow(row = {}) {
  return {
    symbol: String(row.symbol || "").toUpperCase(),
    positionAmt: toNumber(row.positionAmt ?? row.positionAmount ?? row.amount),
    entryPrice: toNumber(row.entryPrice),
    markPrice: toNumber(row.markPrice),
    unrealizedProfit: toNumber(row.unRealizedProfit ?? row.unrealizedProfit),
    liquidationPrice: toNumber(row.liquidationPrice),
    leverage: toNumber(row.leverage),
    marginType: row.marginType || null,
    positionSide: row.positionSide || "BOTH",
    raw: row,
  };
}

function normalizeOpenOrderRow(row = {}) {
  return {
    symbol: String(row.symbol || "").toUpperCase(),
    orderId: row.orderId ?? null,
    clientOrderId: row.clientOrderId ?? null,
    side: row.side || null,
    positionSide: row.positionSide || null,
    type: row.type || null,
    status: row.status || null,
    price: toNumber(row.price),
    stopPrice: toNumber(row.stopPrice),
    origQty: toNumber(row.origQty),
    executedQty: toNumber(row.executedQty),
    cumQuote: toNumber(row.cumQuote ?? row.cummulativeQuoteQty),
    time: row.time ?? null,
    updateTime: row.updateTime ?? null,
    raw: row,
  };
}

async function getFuturesAccountSnapshot() {
  const [balanceRows, account, openOrders, positions] = await Promise.all([
    typeof binance.futuresBalance === "function" ? binance.futuresBalance() : [],
    typeof binance.futuresAccount === "function" ? binance.futuresAccount() : {},
    typeof binance.futuresOpenOrders === "function" ? binance.futuresOpenOrders() : [],
    (binance.futuresPositionRisk || binance.futuresPositionInformation || binance.futuresPositionInfo)
      ? (binance.futuresPositionRisk || binance.futuresPositionInformation || binance.futuresPositionInfo).call(
          binance
        )
      : [],
  ]);

  const balances = (Array.isArray(balanceRows) ? balanceRows : [])
    .map(normalizeBalanceRow)
    .filter((row) => row.asset && row.marginBalance > 0);

  const quoteBalance =
    balances.find((row) => row.asset === FUTURES_QUOTE_ASSET) ||
    balances.find((row) => row.availableBalance > 0) ||
    null;

  const normalizedPositions = (Array.isArray(positions) ? positions : [])
    .map(normalizePositionRow)
    .filter((row) => Math.abs(row.positionAmt) > 1e-12);

  return {
    fetchedAt: Date.now(),
    snapshotType: "futures",
    quoteAsset: quoteBalance?.asset || FUTURES_QUOTE_ASSET,
    availableBalance: toNumber(
      account?.availableBalance ?? quoteBalance?.availableBalance ?? quoteBalance?.marginBalance
    ),
    totalWalletBalance: toNumber(
      account?.totalWalletBalance ?? quoteBalance?.walletBalance ?? quoteBalance?.marginBalance
    ),
    totalMarginBalance: toNumber(
      account?.totalMarginBalance ?? quoteBalance?.marginBalance ?? quoteBalance?.walletBalance
    ),
    totalUnrealizedProfit: toNumber(account?.totalUnrealizedProfit),
    balances,
    assets: balances,
    openOrders: (Array.isArray(openOrders) ? openOrders : []).map(normalizeOpenOrderRow),
    positions: normalizedPositions,
    raw: account || {},
  };
}

module.exports = {
  getFuturesAccountSnapshot,
  getAccountSnapshot: getFuturesAccountSnapshot,
};
