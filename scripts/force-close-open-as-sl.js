// scripts/force-close-open-as-sl.js (v2)
// Closes BOTH openExecutions and openSignals as SL, to fix desync with Binance.
// Usage:
//   node scripts/force-close-open-as-sl.js ./runtime/state.json [--symbol ETHUSDC] [--dry-run]
// Notes:
// - If you omit the state path, it defaults to ./runtime/state.json (same folder you run from).
// - It will:
//     1) move matching openExecutions -> closedExecutions (outcome SL)
//     2) move matching openSignals    -> closedSignals    (outcome SL)
//     3) clear them from open* arrays so the dashboard stops showing them as OPEN.

const fs = require('fs');
const path = require('path');

function nowIsoSafe() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function asNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function calcPnlPctAtSL({ direction, entry, sl }) {
  const e = asNumber(entry);
  const s = asNumber(sl);
  if (!e || !s) return null;
  if (String(direction).toUpperCase() === 'SHORT') {
    // short profits when price goes DOWN
    return ((e - s) / e) * 100;
  }
  // long profits when price goes UP
  return ((s - e) / e) * 100;
}

function calcRRPlanned({ direction, entry, sl, tp }) {
  const e = asNumber(entry);
  const s = asNumber(sl);
  const t = asNumber(tp);
  if (!e || !s || !t) return null;

  const dir = String(direction).toUpperCase();
  const risk = dir === 'SHORT' ? (s - e) : (e - s);
  const reward = dir === 'SHORT' ? (e - t) : (t - e);

  if (!Number.isFinite(risk) || risk <= 0) return null;
  if (!Number.isFinite(reward)) return null;

  return reward / risk;
}

function parseArgs(argv) {
  const out = {
    statePath: null,
    symbol: null,
    dryRun: false,
  };

  const args = argv.slice(2);

  // first non-flag is path
  for (const a of args) {
    if (!a.startsWith('--')) {
      out.statePath = a;
      break;
    }
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    if (a === '--symbol') out.symbol = args[i + 1];
  }

  if (!out.statePath) {
    out.statePath = path.join(process.cwd(), 'runtime', 'state.json');
  }

  return out;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function main() {
  const { statePath, symbol, dryRun } = parseArgs(process.argv);

  if (!fs.existsSync(statePath)) {
    console.error(`[CLEANUP] state.json not found: ${statePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(statePath, 'utf-8');
  const state = JSON.parse(raw);

  const symFilter = symbol ? String(symbol).toUpperCase() : null;

  state.openExecutions = Array.isArray(state.openExecutions) ? state.openExecutions : [];
  state.closedExecutions = Array.isArray(state.closedExecutions) ? state.closedExecutions : [];
  state.openSignals = Array.isArray(state.openSignals) ? state.openSignals : [];
  state.closedSignals = Array.isArray(state.closedSignals) ? state.closedSignals : [];

  const backupPath = path.join(
    path.dirname(statePath),
    `state.backup-${nowIsoSafe()}.json`
  );

  const changed = {
    executionsClosed: 0,
    signalsMoved: 0,
    skippedExec: 0,
    skippedSig: 0,
  };

  // 1) openExecutions -> closedExecutions
  const remainingExec = [];
  for (const ex of state.openExecutions) {
    const exSym = String(ex?.symbol || '').toUpperCase();
    if (symFilter && exSym !== symFilter) {
      remainingExec.push(ex);
      changed.skippedExec++;
      continue;
    }

    // already closed?
    if (String(ex?.status || '').toUpperCase() !== 'OPEN') {
      remainingExec.push(ex);
      changed.skippedExec++;
      continue;
    }

    const closed = {
      ...deepClone(ex),
      status: 'CLOSED',
      outcome: 'SL',
      closeReason: 'forced_cleanup',
      closedTs: Date.now(),
    };

    state.closedExecutions.push(closed);
    changed.executionsClosed++;
  }
  state.openExecutions = remainingExec;

  // 2) openSignals -> closedSignals
  const remainingSignals = [];
  for (const sig of state.openSignals) {
    const sSym = String(sig?.symbol || '').toUpperCase();
    if (symFilter && sSym !== symFilter) {
      remainingSignals.push(sig);
      changed.skippedSig++;
      continue;
    }

    // Some older states may keep a flag; respect it if present.
    const st = String(sig?.status || 'OPEN').toUpperCase();
    if (st !== 'OPEN') {
      remainingSignals.push(sig);
      changed.skippedSig++;
      continue;
    }

    const direction = sig?.direction || sig?.side || 'LONG';
    const entry = sig?.entry;
    const sl = sig?.sl;
    const tp = sig?.tp;

    const pnlPct = calcPnlPctAtSL({ direction, entry, sl });
    const rrPlanned = calcRRPlanned({ direction, entry, sl, tp });

    const closedSig = {
      ...deepClone(sig),
      status: 'CLOSED',
      outcome: 'SL',
      exitRef: sl ?? null,
      closedTs: Date.now(),
      // Keep the original signal timestamp if it exists; if not, store now
      signalTs: sig?.signalTs ?? sig?.ts ?? Date.now(),
      ts: sig?.ts ?? Date.now(),
      executionAttempted: sig?.executionAttempted ?? true,
      executionApproved: sig?.executionApproved ?? true,
      executionReason: 'forced_cleanup',
      pnlPct: pnlPct,
      rrPlanned: rrPlanned,
      rrRealized: pnlPct == null ? null : -1,
      barsOpen: sig?.barsOpen ?? null,
    };

    state.closedSignals.push(closedSig);
    changed.signalsMoved++;
  }
  state.openSignals = remainingSignals;

  if (dryRun) {
    console.log('[CLEANUP] DRY RUN — no file changes.');
    console.log(`[CLEANUP] Would close executions=${changed.executionsClosed}, move signals=${changed.signalsMoved}`);
    return;
  }

  // Write backup and updated state
  fs.writeFileSync(backupPath, raw, 'utf-8');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  console.log(`[CLEANUP] Done. executions closed=${changed.executionsClosed}, signals moved=${changed.signalsMoved}, skippedExec=${changed.skippedExec}, skippedSig=${changed.skippedSig}`);
  console.log(`[CLEANUP] Backup: ${backupPath}`);
  console.log(`[CLEANUP] Updated: ${statePath}`);
}

main();
