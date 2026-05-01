require("dotenv").config();
const {
 getAssetBalance,
 getOpenOrders,
 getAccountSnapshot,
} = require("./binance-account");

async function main() {
 const usdc = await getAssetBalance("USDC");
 const btc = await getAssetBalance("BTC");
 const openOrders = await getOpenOrders();
 const snapshot = await getAccountSnapshot();

 console.log("USDC:", usdc);
 console.log("BTC:", btc);
 console.log("Open Orders:", openOrders.length);
 console.log("Top balances:", snapshot.balances.slice(0, 10));
}

main().catch((err) => {
 console.error("Erro:", err.response?.data || err.message || err);
 process.exit(1);
});