#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_STATE_FILE = path.join(ROOT, "runtime", "state.json");
const DEFAULT_REGISTRY_FILE = path.join(
  ROOT,
  "research",
  "cache",
  "server-strategy-hunts",
  "candidate-registry.json"
);
const JOURNAL_DIR = path.join(ROOT, "docs", "system-journal");
const NOTES_DIR = path.join(JOURNAL_DIR, "notes");
const INDEX_FILE = path.join(ROOT, "docs", "SYSTEM_JOURNAL.md");
const DEFAULT_TIMEZONE = "Europe/Lisbon";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function toDateParts(ts, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(ts)).map((part) => [part.type, part.value])
  );
  return parts;
}

function dayKeyFromTs(ts, timeZone) {
  const parts = toDateParts(ts, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateTimeFromTs(ts, timeZone) {
  const parts = toDateParts(ts, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function nowDayKey(timeZone) {
  return dayKeyFromTs(Date.now(), timeZone);
}

function formatPct(value) {
  if (!Number.isFinite(Number(value))) {
    return "n/a";
  }
  const num = Number(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(3)}%`;
}

function formatUsd(value) {
  if (!Number.isFinite(Number(value))) {
    return "n/a";
  }
  const num = Number(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(3)} USDC`;
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) {
    return "n/a";
  }
  return Number(value).toFixed(digits);
}

function getRealClosedSignals(state) {
  return (state.closedSignals || []).filter((trade) =>
    String(trade.executionOrderId || "").startsWith("futures_real_")
  );
}

function getRealOpenSignals(state) {
  return (state.openSignals || []).filter((trade) =>
    String(trade.executionOrderId || "").startsWith("futures_real_")
  );
}

function favorableProgress(trade) {
  const entry = Number(trade.entryPrice ?? trade.entry);
  const tp = Number(trade.tp);
  if (!Number.isFinite(entry) || !Number.isFinite(tp) || entry === tp) {
    return null;
  }
  if (trade.direction === "LONG") {
    const maxHigh = Number(trade.maxHighDuringTrade);
    const dist = tp - entry;
    if (!Number.isFinite(maxHigh) || !(dist > 0)) {
      return null;
    }
    return (maxHigh - entry) / dist;
  }
  const minLow = Number(trade.minLowDuringTrade);
  const dist = entry - tp;
  if (!Number.isFinite(minLow) || !(dist > 0)) {
    return null;
  }
  return (entry - minLow) / dist;
}

function gitLogForDay(dayKey) {
  try {
    return execSync(
      `git log --since='${dayKey} 00:00:00' --until='${dayKey} 23:59:59' --date=short --pretty=format:'%h %ad %s' -- . ':(exclude)runtime/*.json'`,
      { cwd: ROOT, encoding: "utf8" }
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function summarizeDayTrades(trades, dayKey, timeZone) {
  const todayTrades = trades
    .filter((trade) => dayKeyFromTs(trade.closedTs || trade.ts, timeZone) === dayKey)
    .sort((a, b) => (a.closedTs || a.ts) - (b.closedTs || b.ts));

  const wins = todayTrades.filter((trade) => Number(trade.pnlPct) > 0).length;
  const losses = todayTrades.filter((trade) => Number(trade.pnlPct) < 0).length;
  const flats = todayTrades.length - wins - losses;
  const avgPnlPct =
    todayTrades.length > 0
      ? todayTrades.reduce((sum, trade) => sum + Number(trade.pnlPct || 0), 0) /
        todayTrades.length
      : 0;
  const knownUsdTrades = todayTrades.filter((trade) =>
    Number.isFinite(Number(trade.realizedPnlUsd))
  );
  const realizedUsd = knownUsdTrades.reduce(
    (sum, trade) => sum + Number(trade.realizedPnlUsd || 0),
    0
  );

  return {
    todayTrades,
    wins,
    losses,
    flats,
    avgPnlPct,
    realizedUsd,
    knownUsdCount: knownUsdTrades.length,
  };
}

function summarizeNearTpCore(trades) {
  const currentCore = new Set([
    "ADAUSDC|5m|cipherContinuationLong",
    "LINKUSDC|5m|cipherContinuationLong",
    "ETHUSDC|1h|cipherContinuationShort",
    "BTCUSDC|1h|cipherContinuationShort",
    "BTCUSDC|1h|breakdownRetestShort",
    "BTCUSDC|1h|cipherContinuationLong",
    "1000SHIBUSDC|15m|cipherContinuationShort",
  ]);

  const rows = trades
    .map((trade) => ({
      key: `${trade.symbol}|${trade.tf}|${trade.strategy}`,
      symbol: trade.symbol,
      tf: trade.tf,
      strategy: trade.strategy,
      outcome: trade.outcome,
      pnlPct: Number(trade.pnlPct || 0),
      progress: favorableProgress(trade),
      breakEvenApplied: !!trade.breakEvenApplied,
      ts: trade.closedTs || trade.ts,
    }))
    .filter((trade) => currentCore.has(trade.key) && trade.progress != null);

  const nonTp = rows.filter((trade) => trade.outcome !== "TP");
  const near80 = nonTp.filter((trade) => trade.progress >= 0.8);
  const near90 = nonTp.filter((trade) => trade.progress >= 0.9);

  const byLane = {};
  for (const trade of nonTp) {
    byLane[trade.key] = byLane[trade.key] || {
      count: 0,
      near80: 0,
      near90: 0,
      avgNonTp: 0,
    };
    byLane[trade.key].count += 1;
    byLane[trade.key].avgNonTp += trade.pnlPct;
    if (trade.progress >= 0.8) {
      byLane[trade.key].near80 += 1;
    }
    if (trade.progress >= 0.9) {
      byLane[trade.key].near90 += 1;
    }
  }
  for (const lane of Object.values(byLane)) {
    lane.avgNonTp = lane.count ? lane.avgNonTp / lane.count : 0;
  }

  return {
    totalClosedCore: rows.length,
    nonTpCount: nonTp.length,
    near80Count: near80.length,
    near90Count: near90.length,
    byLane,
  };
}

function loadCandidateSnapshot(registryFile) {
  const registry = readJsonIfExists(registryFile, null);
  if (!registry) {
    return null;
  }
  return {
    counts: registry.counts || { live: 0, observe: 0, archive: 0 },
    topCandidates: Array.isArray(registry.topCandidates)
      ? registry.topCandidates.slice(0, 5)
      : [],
  };
}

function buildObstacles({
  daySummary,
  openRealSignals,
  nearTpCore,
  candidateSnapshot,
}) {
  const items = [];
  if (daySummary.todayTrades.length === 0) {
    items.push("Sem trades reais fechadas no dia analisado; o problema do período é frequência, não ausência de motor.");
  }
  if (daySummary.losses > 0) {
    items.push(
      `Houve ${daySummary.losses} loss(es) real(is) no dia; é preciso validar se foram mismatch de regime, chase ou gestão tardia.`
    );
  }
  if (nearTpCore.near80Count > 0) {
    items.push(
      `O core atual já mostrou ${nearTpCore.near80Count} caso(s) não-TP que chegaram a pelo menos 80% do caminho até ao alvo; isso aponta para gestão/TP a precisar de calibração fina, sobretudo quando o movimento “quase entrega”.`
    );
  }
  if (openRealSignals.length > 0) {
    items.push(
      `Existem ${openRealSignals.length} posição(ões) real(is) aberta(s), por isso o estado do sistema ainda está parcialmente em risco intradiário.`
    );
  }
  if (candidateSnapshot && (candidateSnapshot.counts.observe || 0) === 0 && (candidateSnapshot.counts.live || 0) === 0) {
    items.push("O strategy hunt não está a devolver candidatos fortes neste snapshot; o lab continua mais útil como triagem do que como fonte imediata de promoção.");
  }
  return items;
}

function buildPlan({ daySummary, nearTpCore, openRealSignals, candidateSnapshot }) {
  const items = [];
  if (openRealSignals.some((trade) => trade.symbol === "BTCUSDC")) {
    items.push("Monitorizar o lane `BTCUSDC 1h short` com a gestão específica nova (`BE 0.30 / lock 0.10`) até termos amostra suficiente para confirmar se reduz o dano sem matar edge.");
  }
  if ((nearTpCore.byLane["ADAUSDC|5m|cipherContinuationLong"] || {}).near80 > 0) {
    items.push("Medir no lab se `ADAUSDC 5m cipherContinuationLong` beneficia mais de `front-run` ligeiro do TP ou de break-even/lock mais cedo antes de zonas óbvias de liquidez.");
  }
  if (daySummary.todayTrades.length === 0 || daySummary.losses > daySummary.wins) {
    items.push("Continuar a reforçar cobertura bearish/líder no live e no lab, em vez de afrouxar `ADA/LINK long` às cegas.");
  }
  if (candidateSnapshot && candidateSnapshot.topCandidates.length === 0) {
    items.push("Manter o hunt a rodar e melhorar o registry para distinguir melhor `observe promissor` de `arquivo sem edge`, evitando desperdiçar tempo com famílias já mortas.");
  }
  if (items.length === 0) {
    items.push("Manter o core estável, recolher mais amostra real e só promover novas regras quando houver ganho claro de cobertura ou gestão.");
  }
  return items;
}

function buildEntryMarkdown({
  dayKey,
  timeZone,
  stateFile,
  gitLog,
  daySummary,
  openRealSignals,
  nearTpCore,
  candidateSnapshot,
  manualNotes,
}) {
  const generatedAt = dateTimeFromTs(Date.now(), timeZone);
  const tradeLines =
    daySummary.todayTrades.length === 0
      ? ["- Sem trades reais fechadas neste dia."]
      : daySummary.todayTrades.map((trade) => {
          const closedAt = dateTimeFromTs(trade.closedTs || trade.ts, timeZone);
          return `- \`${trade.symbol} ${trade.tf} ${trade.strategy}\` -> \`${trade.outcome}\` | \`${formatPct(
            trade.pnlPct
          )}\`${Number.isFinite(Number(trade.realizedPnlUsd)) ? ` | \`${formatUsd(trade.realizedPnlUsd)}\`` : ""} | fechada às \`${closedAt}\``;
        });

  const openLines =
    openRealSignals.length === 0
      ? ["- Sem posições reais abertas no snapshot usado para este journal."]
      : openRealSignals.map((trade) => {
          const overrides = [];
          if (Number.isFinite(Number(trade.managementBreakEvenTriggerR))) {
            overrides.push(`BE trigger ${formatNumber(trade.managementBreakEvenTriggerR, 2)}R`);
          }
          if (Number.isFinite(Number(trade.managementBreakEvenLockR))) {
            overrides.push(`lock ${formatNumber(trade.managementBreakEvenLockR, 2)}R`);
          }
          return `- \`${trade.symbol} ${trade.tf} ${trade.strategy} ${trade.direction}\` | entry \`${trade.entryPrice ?? trade.entry}\` | barsOpen \`${trade.barsOpen ?? "n/a"}\`${overrides.length ? ` | ${overrides.join(" / ")}` : ""}`;
        });

  const gitLines =
    gitLog.length === 0 ? ["- Sem commits locais registados para este dia."] : gitLog.map((line) => `- ${line}`);

  const obstacleLines = buildObstacles({
    daySummary,
    openRealSignals,
    nearTpCore,
    candidateSnapshot,
  });

  const planLines = buildPlan({
    daySummary,
    nearTpCore,
    openRealSignals,
    candidateSnapshot,
  });

  const candidateLines = candidateSnapshot
    ? [
        `- counts: live \`${candidateSnapshot.counts.live || 0}\`, observe \`${candidateSnapshot.counts.observe || 0}\`, archive \`${candidateSnapshot.counts.archive || 0}\``,
        ...(candidateSnapshot.topCandidates.length
          ? candidateSnapshot.topCandidates.map((candidate) => {
              const label = [
                candidate.symbol,
                candidate.tf,
                candidate.strategy,
                candidate.recommendation || candidate.status || "n/a",
              ]
                .filter(Boolean)
                .join(" | ");
              const metrics = [
                Number.isFinite(Number(candidate.trades)) ? `trades ${candidate.trades}` : null,
                Number.isFinite(Number(candidate.avgNetPnlPct)) ? `avgNet ${formatPct(candidate.avgNetPnlPct)}` : null,
                Number.isFinite(Number(candidate.profitFactorNet)) ? `PF ${formatNumber(candidate.profitFactorNet, 3)}` : null,
                Number.isFinite(Number(candidate.maxDrawdownPct)) ? `maxDD ${formatPct(candidate.maxDrawdownPct)}` : null,
              ]
                .filter(Boolean)
                .join(" | ");
              return `- ${label}${metrics ? ` | ${metrics}` : ""}`;
            })
          : ["- Sem candidatos destacados no snapshot atual."]),
      ]
    : ["- Candidate registry indisponível neste snapshot."];

  const manualSection =
    manualNotes && manualNotes.trim()
      ? `\n## Avarias E Observações Manuais\n\n${manualNotes.trim()}\n`
      : "\n## Avarias E Observações Manuais\n\n- Sem notas manuais adicionais para este dia.\n";

  return `# System Journal ${dayKey}

- Gerado em: \`${generatedAt}\` (${timeZone})
- Fonte principal de estado: \`${stateFile}\`

## Situação Do Sistema

- Trades reais fechadas no dia: \`${daySummary.todayTrades.length}\`
- Wins / Losses / Flats: \`${daySummary.wins}\` / \`${daySummary.losses}\` / \`${daySummary.flats}\`
- PnL médio por trade do dia: \`${formatPct(daySummary.avgPnlPct)}\`
- PnL realizado conhecido do dia: \`${formatUsd(daySummary.realizedUsd)}\` em \`${daySummary.knownUsdCount}\` trade(s) com USD registado
- Posições reais abertas no snapshot: \`${openRealSignals.length}\`

## Trades Reais Do Dia

${tradeLines.join("\n")}

## Posições Abertas No Snapshot

${openLines.join("\n")}

## Modificações Do Dia

${gitLines.join("\n")}
${manualSection}
## Sinais De Obstáculo

${obstacleLines.length ? obstacleLines.map((line) => `- ${line}`).join("\n") : "- Sem bloqueios relevantes identificados neste snapshot."}

## Near-TP / Reversões Do Core

- Trades fechadas do core com dados suficientes: \`${nearTpCore.totalClosedCore}\`
- Não-TP do core que chegaram a pelo menos 80% do caminho até ao alvo: \`${nearTpCore.near80Count}\`
- Não-TP do core que chegaram a pelo menos 90% do caminho até ao alvo: \`${nearTpCore.near90Count}\`
- Lanes com mais fricção:
${Object.keys(nearTpCore.byLane).length
  ? Object.entries(nearTpCore.byLane)
      .map(
        ([lane, stats]) =>
          `  - \`${lane}\`: non-TP \`${stats.count}\`, near80 \`${stats.near80}\`, near90 \`${stats.near90}\`, avgNonTP \`${formatPct(stats.avgNonTp)}\``
      )
      .join("\n")
  : "  - Sem dados suficientes no core atual."}

## Snapshot Do Lab / Hunt

${candidateLines.join("\n")}

## Plano De Mitigação

${planLines.map((line) => `- ${line}`).join("\n")}
`;
}

function rebuildIndex() {
  ensureDir(JOURNAL_DIR);
  const files = fs
    .readdirSync(JOURNAL_DIR)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .sort()
    .reverse();
  const latest = files[0] || null;
  const lines = [
    "# System Journal",
    "",
    "Registo operacional diário do sistema: modificações, avarias, trades reais, estado de lucro/perda e plano de mitigação.",
    "",
    latest
      ? `- Última entrada: [${latest.replace(/\.md$/, "")}](/Users/joel/Documents/CoddingStuff/TorusAiTrading/docs/system-journal/${latest})`
      : "- Ainda sem entradas geradas.",
    "",
    "## Entradas",
    "",
    ...files.map(
      (file) =>
        `- [${file.replace(/\.md$/, "")}](/Users/joel/Documents/CoddingStuff/TorusAiTrading/docs/system-journal/${file})`
    ),
  ];
  fs.writeFileSync(INDEX_FILE, `${lines.join("\n")}\n`);
}

function main() {
  const args = parseArgs(process.argv);
  const timeZone = args.timezone || DEFAULT_TIMEZONE;
  const dayKey = args.date || nowDayKey(timeZone);
  const stateFile = path.resolve(args["state-file"] || DEFAULT_STATE_FILE);
  const registryFile = path.resolve(args["registry-file"] || DEFAULT_REGISTRY_FILE);

  const state = readJsonIfExists(stateFile, null);
  if (!state) {
    console.error(`State file not found or invalid: ${stateFile}`);
    process.exit(1);
  }

  ensureDir(JOURNAL_DIR);
  ensureDir(NOTES_DIR);

  const trades = getRealClosedSignals(state);
  const openRealSignals = getRealOpenSignals(state);
  const daySummary = summarizeDayTrades(trades, dayKey, timeZone);
  const nearTpCore = summarizeNearTpCore(trades);
  const gitLog = gitLogForDay(dayKey);
  const candidateSnapshot = loadCandidateSnapshot(registryFile);
  const noteFile = path.join(NOTES_DIR, `${dayKey}.md`);
  const manualNotes = fs.existsSync(noteFile) ? fs.readFileSync(noteFile, "utf8") : "";

  const markdown = buildEntryMarkdown({
    dayKey,
    timeZone,
    stateFile,
    gitLog,
    daySummary,
    openRealSignals,
    nearTpCore,
    candidateSnapshot,
    manualNotes,
  });

  const outputFile = path.join(JOURNAL_DIR, `${dayKey}.md`);
  fs.writeFileSync(outputFile, markdown);
  rebuildIndex();

  console.log(JSON.stringify({ outputFile, indexFile: INDEX_FILE }, null, 2));
}

main();
