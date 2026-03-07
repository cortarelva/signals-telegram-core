const fs = require("fs");

const STATE_FILE = "./state.json";

function parseArg(name, defaultValue) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return defaultValue;
  return Number(process.argv[idx + 1]);
}

const slAtrMult = parseArg("--slAtrMult", 1.2);
const tpAtrMult = parseArg("--tpAtrMult", 1.6);

function simulate(state) {

  const trades = state.closedSignals || [];

  if (!trades.length) {
    console.log("No closed trades found.");
    return;
  }

  let tp = 0;
  let sl = 0;
  let unknown = 0;

  for (const t of trades) {

    const newSL = t.entry - slAtrMult * t.atr;
    const newTP = t.entry + tpAtrMult * t.atr;

    let result = "UNKNOWN";

    if (t.maxHighDuringTrade != null && t.minLowDuringTrade != null) {

      if (t.minLowDuringTrade <= newSL) result = "SL";
      else if (t.maxHighDuringTrade >= newTP) result = "TP";

    } else {

      // fallback: usa resultado real
      result = t.outcome || "UNKNOWN";

    }

    if (result === "TP") tp++;
    else if (result === "SL") sl++;
    else unknown++;

    console.log(
      `${t.symbol} entry=${t.entry} newSL=${newSL.toFixed(2)} newTP=${newTP.toFixed(2)} -> ${result}`
    );

  }

  const total = tp + sl;

  console.log("\n====== SIMULATION RESULT ======");
  console.log("TP:", tp);
  console.log("SL:", sl);
  console.log("UNKNOWN:", unknown);

  if (total > 0) {
    console.log("Winrate:", ((tp / total) * 100).toFixed(2) + "%");
  }
}

const state = JSON.parse(fs.readFileSync(STATE_FILE));
simulate(state);