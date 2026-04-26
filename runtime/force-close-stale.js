const fs = require("fs");

const stateFile = process.argv[2] || "runtime/state.json";
const symbol = process.argv[3] || "XRPUSDC";
const exitPrice = Number(process.argv[4] || 1.3831); // mete aqui o preço real de fecho
const reason = process.argv[5] || "EXCHANGE_SYNC_CLOSE";

const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const executions = Array.isArray(state.executions) ? state.executions : [];

const exec = [...executions].reverse().find(
  (e) =>
    e &&
    e.symbol === symbol &&
    e.mode === "binance_real" &&
    e.status === "OPEN"
);

if (!exec) {
  console.error(`Nenhuma execution OPEN encontrada para ${symbol}`);
  process.exit(1);
}

const now = Date.now();
const direction =
  String(exec.direction || exec.side || "LONG").toUpperCase() === "SHORT"
    ? "SHORT"
    : "LONG";

const qty = Number(exec.quantity || 0);
const entry = Number(exec.entry || exec.entryPrice || 0);

const pnlPct =
  direction === "LONG"
    ? ((exitPrice - entry) / entry) * 100
    : ((entry - exitPrice) / entry) * 100;

const pnlUsd =
  direction === "LONG"
    ? (exitPrice - entry) * qty
    : (entry - exitPrice) * qty;

exec.status = "CLOSED";
exec.closedTs = now;
exec.closeReason = reason;
exec.outcome = reason;
exec.exitPrice = Number(exitPrice);
exec.pnlPct = Number(pnlPct.toFixed(4));
exec.pnlUsd = Number(pnlUsd.toFixed(6));

fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

console.log("Execution fechada no state:");
console.log({
  symbol: exec.symbol,
  direction,
  entry,
  exitPrice: exec.exitPrice,
  pnlPct: exec.pnlPct,
  pnlUsd: exec.pnlUsd,
  closeReason: exec.closeReason,
});