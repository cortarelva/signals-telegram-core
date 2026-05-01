const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RUNTIME_DIR = path.join(ROOT, "runtime");
const LOG_DIR = path.join(ROOT, "logs");
const WATCHDOG_LOG_FILE = path.join(LOG_DIR, "trade-flow-watchdog.log");

const STATE_FILE = path.join(RUNTIME_DIR, "state.json");
const CONFIG_FILE = path.join(RUNTIME_DIR, "strategy-config.json");
const WATCHDOG_STATE_FILE = path.join(RUNTIME_DIR, "trade-flow-watchdog-state.json");
const WATCHDOG_BACKUP_FILE = path.join(
  RUNTIME_DIR,
  "strategy-config.trade-flow-backup.json"
);

const INITIAL_DELAY_MS = Number(process.env.TRADE_FLOW_DELAY_MS || 60 * 60 * 1000);
const POLL_MS = Number(process.env.TRADE_FLOW_POLL_MS || 10 * 60 * 1000);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${nowIso()}] ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(WATCHDOG_LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // Keep stdout logging even if file logging fails.
  }
}

function getTradeSnapshot() {
  const state = readJson(STATE_FILE, {});
  const openSignals = Array.isArray(state.openSignals) ? state.openSignals : [];
  const closedSignals = Array.isArray(state.closedSignals) ? state.closedSignals : [];
  const lastClosed = closedSignals[closedSignals.length - 1] || null;
  const lastOpen = openSignals[openSignals.length - 1] || null;

  return {
    openCount: openSignals.length,
    closedCount: closedSignals.length,
    lastClosedTs: Number(lastClosed?.closedTs || lastClosed?.ts || 0) || 0,
    lastOpenTs: Number(lastOpen?.ts || 0) || 0,
  };
}

function hasNewTradeActivity(baseline, current) {
  return (
    current.openCount > baseline.openCount ||
    current.closedCount > baseline.closedCount ||
    current.lastClosedTs > baseline.lastClosedTs ||
    current.lastOpenTs > baseline.lastOpenTs
  );
}

function ensureBackup(config) {
  if (!fs.existsSync(WATCHDOG_BACKUP_FILE)) {
    writeJson(WATCHDOG_BACKUP_FILE, config);
    log(`Backup created at ${WATCHDOG_BACKUP_FILE}`);
  }
}

function setNested(target, pathParts, value) {
  let ref = target;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const key = pathParts[i];
    if (typeof ref[key] !== "object" || ref[key] === null || Array.isArray(ref[key])) {
      ref[key] = {};
    }
    ref = ref[key];
  }
  ref[pathParts[pathParts.length - 1]] = value;
}

function adjustNumber(target, pathParts, adjustFn) {
  let ref = target;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const key = pathParts[i];
    if (typeof ref[key] !== "object" || ref[key] === null || Array.isArray(ref[key])) {
      ref[key] = {};
    }
    ref = ref[key];
  }
  const key = pathParts[pathParts.length - 1];
  const current = Number(ref[key]);
  ref[key] = adjustFn(Number.isFinite(current) ? current : undefined);
}

const RELAXATION_STAGES = [
  {
    id: "stage-1-enable-ada-15m-trend",
    description:
      "Enable ADAUSDC trend on 15m to open one historically active, currently disabled path.",
    apply(config) {
      setNested(config, ["ADAUSDC", "TREND", "allow15m"], true);
      return [
        "ADAUSDC.TREND.allow15m=true",
      ];
    },
  },
  {
    id: "stage-2-lower-trend-short-min-score",
    description:
      "Lower TREND_SHORT minScore slightly on active symbols while keeping SR, pullback, and RSI-falling filters intact.",
    apply(config) {
      adjustNumber(config, ["ETHUSDC", "TREND_SHORT", "minScore"], (v) =>
        Math.max((v ?? 70) - 4, 66)
      );
      adjustNumber(config, ["BNBUSDC", "TREND_SHORT", "minScore"], (v) =>
        Math.max((v ?? 68) - 4, 64)
      );
      adjustNumber(config, ["ADAUSDC", "TREND_SHORT", "minScore"], (v) =>
        Math.max((v ?? 74) - 4, 70)
      );
      return [
        "ETHUSDC.TREND_SHORT.minScore-=4 floor 66",
        "BNBUSDC.TREND_SHORT.minScore-=4 floor 64",
        "ADAUSDC.TREND_SHORT.minScore-=4 floor 70",
      ];
    },
  },
  {
    id: "stage-3-lower-trend-short-min-adx",
    description:
      "Lower TREND_SHORT minAdx slightly on active symbols after score easing still produced no trades.",
    apply(config) {
      adjustNumber(config, ["ETHUSDC", "TREND_SHORT", "minAdx"], (v) =>
        Math.max((v ?? 18) - 2, 16)
      );
      adjustNumber(config, ["BNBUSDC", "TREND_SHORT", "minAdx"], (v) =>
        Math.max((v ?? 16) - 2, 14)
      );
      adjustNumber(config, ["ADAUSDC", "TREND_SHORT", "minAdx"], (v) =>
        Math.max((v ?? 18) - 2, 16)
      );
      return [
        "ETHUSDC.TREND_SHORT.minAdx-=2 floor 16",
        "BNBUSDC.TREND_SHORT.minAdx-=2 floor 14",
        "ADAUSDC.TREND_SHORT.minAdx-=2 floor 16",
      ];
    },
  },
];

function applyNextRelaxation(watchdogState) {
  const config = readJson(CONFIG_FILE, null);
  if (!config) {
    throw new Error(`Could not read ${CONFIG_FILE}`);
  }

  const nextIndex = Number(watchdogState.stageIndex || 0);
  const stage = RELAXATION_STAGES[nextIndex];
  if (!stage) {
    log("No more relaxation stages available. Watchdog will stop.");
    watchdogState.status = "exhausted";
    watchdogState.lastCheckedAt = Date.now();
    watchdogState.lastCheckedIso = nowIso();
    writeJson(WATCHDOG_STATE_FILE, watchdogState);
    return false;
  }

  ensureBackup(config);
  const changes = stage.apply(config);
  writeJson(CONFIG_FILE, config);

  watchdogState.stageIndex = nextIndex + 1;
  watchdogState.lastAppliedStageId = stage.id;
  watchdogState.lastAppliedAt = Date.now();
  watchdogState.lastAppliedIso = nowIso();
  watchdogState.lastAppliedChanges = changes;
  watchdogState.status = "waiting_for_trades";
  writeJson(WATCHDOG_STATE_FILE, watchdogState);

  log(`Applied ${stage.id}: ${changes.join("; ")}`);
  return true;
}

async function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const baseline = getTradeSnapshot();
  const watchdogState = {
    startedAt: Date.now(),
    startedIso: nowIso(),
    baseline,
    stageIndex: 0,
    status: "watching",
    lastCheckedAt: Date.now(),
    lastCheckedIso: nowIso(),
  };
  writeJson(WATCHDOG_STATE_FILE, watchdogState);

  log(
    `Watcher started. Baseline: open=${baseline.openCount}, closed=${baseline.closedCount}, lastClosedTs=${baseline.lastClosedTs}`
  );
  log(`Waiting ${Math.round(INITIAL_DELAY_MS / 60000)} minutes before first inactivity check.`);

  await sleep(INITIAL_DELAY_MS);

  while (true) {
    const current = getTradeSnapshot();
    watchdogState.lastCheckedAt = Date.now();
    watchdogState.lastCheckedIso = nowIso();
    watchdogState.lastSnapshot = current;

    if (hasNewTradeActivity(baseline, current)) {
      watchdogState.status = "trade_activity_detected";
      writeJson(WATCHDOG_STATE_FILE, watchdogState);
      log(
        `Trade activity detected. open=${current.openCount}, closed=${current.closedCount}, lastClosedTs=${current.lastClosedTs}. Watcher exiting.`
      );
      return;
    }

    const applied = applyNextRelaxation(watchdogState);
    if (!applied) return;

    log(`No new trades yet. Rechecking again in ${Math.round(POLL_MS / 60000)} minutes.`);
    await sleep(POLL_MS);
  }
}

main().catch((error) => {
  console.error(`[${nowIso()}] trade-flow-watchdog failed`, error);
  process.exitCode = 1;
});
