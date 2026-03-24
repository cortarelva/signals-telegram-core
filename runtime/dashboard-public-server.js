const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

// state.json está dentro de runtime
const STATE_FILE = path.join(__dirname, "state.json");

// dashboard-public está na raiz do projeto
const PUBLIC_DIR = path.join(__dirname, "..", "dashboard-public");

app.use(express.static(PUBLIC_DIR));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      openSignals: [],
      closedSignals: [],
      executions: [],
    };
  }
}

function buildPublicState() {
  const state = loadState();

  const closed = Array.isArray(state.closedSignals) ? state.closedSignals : [];
  const open = Array.isArray(state.openSignals) ? state.openSignals : [];

  let equity = 1000;
  const equityHistory = [];

  let wins = 0;
  let losses = 0;

  for (const c of closed) {
    if (Number.isFinite(Number(c.pnlPct))) {
      equity *= 1 + Number(c.pnlPct) / 100;
      equityHistory.push(equity);
    }

    if (c.outcome === "TP") wins++;
    if (c.outcome === "SL") losses++;
  }

  const winRate =
    wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

  return {
    balance: equity,
    profit: equity - 1000,
    winRate,
    openTrades: open.slice(-5),
    recentClosed: closed.slice(-10),
    equityHistory,
    timestamp: Date.now(),
  };
}

app.get("/api/public-state", (req, res) => {
  res.json(buildPublicState());
});

app.listen(PORT, () => {
  console.log("Public dashboard running on http://localhost:3001");
});