require("dotenv").config();
const crypto = require("crypto");
const axios = require("axios");

const BINANCE_API_KEY = process.env.BINANCE_API_KEY || "";
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET || "";
const BINANCE_BASE_URL = process.env.BINANCE_BASE_URL || "https://api.binance.com";
const BINANCE_RECV_WINDOW = Number(process.env.BINANCE_RECV_WINDOW || 5000);

function requireKeys() {
 if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
 throw new Error("BINANCE_API_KEY / BINANCE_API_SECRET em falta no .env");
 }
}

function buildSignedQuery(params) {
  const encoded = new URLSearchParams(params).toString();
  const signature = crypto
    .createHmac("sha256", BINANCE_API_SECRET)
    .update(encoded)
    .digest("hex");

  return `${encoded}&signature=${signature}`;
}


async function signedRequest(method, endpoint, params = {}) {
  requireKeys();

  const upperMethod = String(method || "GET").toUpperCase();
  const url = `${BINANCE_BASE_URL}${endpoint}`;

  const signedParams = {
    ...params,
    recvWindow: BINANCE_RECV_WINDOW,
    timestamp: Date.now(),
  };

  const query = buildSignedQuery(signedParams);

  const headers = {
    "X-MBX-APIKEY": BINANCE_API_KEY,
  };

  if (upperMethod === "GET" || upperMethod === "DELETE") {
    const { data } = await axios({
      method: upperMethod,
      url: `${url}?${query}`,
      headers,
      timeout: 15000,
    });

    return data;
  }

  const { data } = await axios({
    method: upperMethod,
    url,
    data: query,
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 15000,
  });

  return data;
}


function normalizeBalances(rawBalances = []) {
 return rawBalances
 .map((b) => ({
 asset: b.asset,
 free: Number(b.free || 0),
 locked: Number(b.locked || 0),
 total: Number(b.free || 0) + Number(b.locked || 0),
 }))
 .filter((b) => b.total > 0)
 .sort((a, b) => b.total - a.total);
}

async function getAccountInfo() {
 const data = await signedRequest("GET", "/api/v3/account");
 return {
 makerCommission: data.makerCommission,
 takerCommission: data.takerCommission,
 buyerCommission: data.buyerCommission,
 sellerCommission: data.sellerCommission,
 canTrade: data.canTrade,
 canWithdraw: data.canWithdraw,
 canDeposit: data.canDeposit,
 updateTime: data.updateTime,
 accountType: data.accountType,
 balances: normalizeBalances(data.balances || []),
 raw: data,
 };
}

async function getAssetBalance(asset) {
 if (!asset) {
 throw new Error("asset é obrigatório");
 }

 const account = await getAccountInfo();
 const wanted = String(asset).toUpperCase();

 const balance =
 account.balances.find((b) => b.asset === wanted) || {
 asset: wanted,
 free: 0,
 locked: 0,
 total: 0,
 };

 return balance;
}

async function getOpenOrders(symbol) {
 const params = {};
 if (symbol) {
 params.symbol = symbol;
 }

 const data = await signedRequest("GET", "/api/v3/openOrders", params);

 return (data || []).map((o) => ({
 symbol: o.symbol,
 orderId: o.orderId,
 clientOrderId: o.clientOrderId,
 side: o.side,
 type: o.type,
 status: o.status,
 price: Number(o.price || 0),
 origQty: Number(o.origQty || 0),
 executedQty: Number(o.executedQty || 0),
 cummulativeQuoteQty: Number(o.cummulativeQuoteQty || 0),
 time: o.time,
 updateTime: o.updateTime,
 raw: o,
 }));
}

async function getOrder(symbol, orderId) {
 if (!symbol || !orderId) {
 throw new Error("symbol e orderId são obrigatórios");
 }

 const data = await signedRequest("GET", "/api/v3/order", {
 symbol,
 orderId,
 });

 return {
 symbol: data.symbol,
 orderId: data.orderId,
 clientOrderId: data.clientOrderId,
 side: data.side,
 type: data.type,
 status: data.status,
 price: Number(data.price || 0),
 origQty: Number(data.origQty || 0),
 executedQty: Number(data.executedQty || 0),
 cummulativeQuoteQty: Number(data.cummulativeQuoteQty || 0),
 time: data.time,
 updateTime: data.updateTime,
 raw: data,
 };
}

async function getAccountSnapshot() {
 const [account, openOrders] = await Promise.all([
 getAccountInfo(),
 getOpenOrders(),
 ]);

 return {
 fetchedAt: Date.now(),
 account,
 balances: account.balances,
 openOrders,
 };
}

module.exports = {
 getAccountInfo,
 getAssetBalance,
 getOpenOrders,
 getOrder,
 getAccountSnapshot,
};