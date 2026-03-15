require("dotenv").config();
const Binance = require("node-binance-api");
const https = require("https");

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  useServerTime: true,
  recvWindow: 60000,
  test: false,
  httpsAgent: keepAliveAgent,
});

async function withRetry(fn, label, tries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt >= tries) throw e;
      const sleep = 2000 * attempt;
      console.log(`[RETRY] ${label} -> ${sleep}ms ::`, e.body || e.message);
      await new Promise(r => setTimeout(r, sleep));
    }
  }
}

(async () => {
  try {
    console.log("PUBLIC TEST");
    const prices = await withRetry(() => binance.prices("BTCUSDT"), "prices");
    console.log("BTCUSDT =", prices.BTCUSDT);

    console.log("\nPRIVATE TEST");
    const balances = await withRetry(() => binance.balance(), "balance");
    console.log("USDT =", balances.USDT);
    console.log("BTC =", balances.BTC);
  } catch (e) {
    console.error("ERRO:", e.body || e.message || e);
  }
})();