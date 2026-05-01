#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const repoRoot = process.cwd();

const HOTSPOT_FILES = [
  "package.json",
  "package-lock.json",
  "runtime/torus-ai-trading.js",
  "runtime/dashboard-server.js",
  "runtime/config/load-runtime-config.js",
  "runtime/futures-executor.js",
  "runtime/risk-manager.js",
  "runtime/strategy-config.json",
  "runtime/btc-regime-context.js",
  "strategies/index.js",
  "strategies/cipher-continuation-long-strategy.js",
  "dashboard/app.js",
  "dashboard/index.html",
  "dashboard/styles.css",
  "research/build-promotion-gate-report.js",
  "docs/MAC_ITERATION_HANDOFF_2026-04-28.md",
];

const ENV_KEYS = [
  "EXECUTION_MODE",
  "TF",
  "HTF_TF",
  "CONTINUATION_RANKER_MAX_PER_CYCLE",
  "ENABLE_TELEGRAM",
  "LIVE_ALLOW_TRADFI",
  "EXTERNAL_HISTORY_PROVIDER",
  "EXTERNAL_HISTORY_TRADFI_ONLY",
  "EXTERNAL_HISTORY_AUTO_TRADFI",
  "FUTURES_RISK_PER_TRADE",
  "FUTURES_MAX_POSITION_USDT",
  "FUTURES_MAX_OPEN_POSITIONS",
  "FUTURES_USE_LIVE_AVAILABLE_BALANCE",
  "FUTURES_BALANCE_USAGE_PCT",
  "FUTURES_MAX_MARGIN_USD",
  "FUTURES_MAX_NOTIONAL_USD",
  "FUTURES_ACCOUNT_SIZE_MODE",
  "FUTURES_MAX_PORTFOLIO_NOTIONAL_USDT",
  "FUTURES_MAX_SIDE_NOTIONAL_USDT",
  "FUTURES_MAX_PORTFOLIO_RISK_USD",
  "FUTURES_MAX_SIDE_RISK_USD",
];

function runGit(cmd) {
  try {
    return execSync(cmd, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function runCommand(cmd) {
  const startedAt = Date.now();
  try {
    const stdout = execSync(cmd, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      command: cmd,
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      snippet: stdout.trim().slice(0, 4000),
    };
  } catch (error) {
    return {
      command: cmd,
      ok: false,
      exitCode: typeof error.status === "number" ? error.status : 1,
      durationMs: Date.now() - startedAt,
      snippet: String(error.stdout || error.stderr || error.message || "").trim().slice(0, 4000),
    };
  }
}

function sha256File(filePath) {
  const absPath = path.join(repoRoot, filePath);
  if (!fs.existsSync(absPath)) return null;
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(absPath));
  return hash.digest("hex");
}

function parseEnvFile() {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return {};
  const result = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!ENV_KEYS.includes(key)) continue;
    result[key] = line.slice(idx + 1).trim();
  }
  return result;
}

function loadStrategyConfig() {
  const cfgPath = path.join(repoRoot, "runtime", "strategy-config.json");
  if (!fs.existsSync(cfgPath)) return null;
  return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
}

function loadPackageMeta() {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return {
    name: pkg.name || null,
    version: pkg.version || null,
    packageJsonSha256: sha256File("package.json"),
    packageLockSha256: sha256File("package-lock.json"),
  };
}

function summarizeSymbol(symbol, cfg) {
  const enabledStrategies = [];
  for (const [key, value] of Object.entries(cfg)) {
    if (value && typeof value === "object" && value.enabled === true) {
      enabledStrategies.push(key);
    }
  }
  const extraRuns = Array.isArray(cfg.EXTRA_RUNS)
    ? cfg.EXTRA_RUNS
        .filter((run) => run && run.ENABLED)
        .map((run) => ({
          id: run.id || null,
          tf: run.TF || null,
          htfTf: run.HTF_TF || null,
          enabledStrategies: Object.entries(run)
            .filter(([, value]) => value && typeof value === "object" && value.enabled === true)
            .map(([name]) => name),
        }))
    : [];

  return {
    tf: cfg.TF || null,
    htfTf: cfg.HTF_TF || null,
    enabledStrategies,
    extraRuns,
  };
}

function buildLiveUniverse(strategyConfig) {
  if (!strategyConfig) return {};
  const result = {};
  for (const [symbol, cfg] of Object.entries(strategyConfig)) {
    if (!cfg || typeof cfg !== "object" || !cfg.ENABLED) continue;
    result[symbol] = summarizeSymbol(symbol, cfg);
  }
  return result;
}

function parseArgs(argv) {
  const args = {
    output: null,
    role: null,
    baselineBranch: null,
    baselineHead: null,
    liveConfirmedBranch: null,
    liveConfirmedHead: null,
    githubCleanBranch: null,
    githubCleanHead: null,
    tuneHead: null,
    testCommand: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--output") {
      args.output = argv[i + 1] || null;
      i += 1;
    } else if (token === "--role") {
      args.role = argv[i + 1] || null;
      i += 1;
    } else if (token === "--baseline-branch") {
      args.baselineBranch = argv[i + 1] || null;
      i += 1;
    } else if (token === "--baseline-head") {
      args.baselineHead = argv[i + 1] || null;
      i += 1;
    } else if (token === "--live-confirmed-branch") {
      args.liveConfirmedBranch = argv[i + 1] || null;
      i += 1;
    } else if (token === "--live-confirmed-head") {
      args.liveConfirmedHead = argv[i + 1] || null;
      i += 1;
    } else if (token === "--github-clean-branch") {
      args.githubCleanBranch = argv[i + 1] || null;
      i += 1;
    } else if (token === "--github-clean-head") {
      args.githubCleanHead = argv[i + 1] || null;
      i += 1;
    } else if (token === "--tune-head") {
      args.tuneHead = argv[i + 1] || null;
      i += 1;
    } else if (token === "--test-command") {
      args.testCommand = argv[i + 1] || null;
      i += 1;
    }
  }
  return args;
}

function buildBaselineRefs(args) {
  const githubCleanBranch = args.githubCleanBranch || args.baselineBranch || null;
  const githubCleanHead = args.githubCleanHead || args.baselineHead || null;
  const refs = {
    liveConfirmed: {
      branch: args.liveConfirmedBranch || null,
      head: args.liveConfirmedHead || null,
    },
    githubClean: {
      branch: githubCleanBranch,
      head: githubCleanHead,
    },
    tuneCommit: {
      head: args.tuneHead || null,
    },
  };

  const hasExplicitNestedRef = Object.values(refs).some((ref) =>
    ref && Object.values(ref).some((value) => value)
  );
  return hasExplicitNestedRef ? refs : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategyConfig = loadStrategyConfig();
  const manifest = {
    generatedAt: new Date().toISOString(),
    role: args.role || "unspecified",
    repoRoot,
    git: {
      branch: runGit("git branch --show-current"),
      head: runGit("git rev-parse HEAD"),
      mergeBaseWithOriginMain: runGit("git merge-base HEAD origin/main"),
      statusShort: runGit("git status --short"),
      statusPorcelain: runGit("git status --porcelain"),
    },
    baselineRefs: buildBaselineRefs(args),
    packageMeta: loadPackageMeta(),
    env: parseEnvFile(),
    liveUniverse: buildLiveUniverse(strategyConfig),
    hotspots: Object.fromEntries(
      HOTSPOT_FILES.map((file) => [
        file,
        {
          exists: fs.existsSync(path.join(repoRoot, file)),
          sha256: sha256File(file),
        },
      ])
    ),
  };

  if (args.testCommand) {
    manifest.testSummary = runCommand(args.testCommand);
  }

  const payload = JSON.stringify(manifest, null, 2);
  if (args.output) {
    fs.writeFileSync(path.resolve(repoRoot, args.output), `${payload}\n`);
    console.log(path.resolve(repoRoot, args.output));
    return;
  }
  process.stdout.write(`${payload}\n`);
}

main();
