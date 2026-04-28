require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CONFIG_FILE = path.join(__dirname, "tradfi-twelve-equities-config.json");
const MONTE_RUNNER = path.join(__dirname, "monte-carlo-trade-list.js");
const OUTPUT_DIR = path.join(__dirname, "cache", "tradfi-twelve-equities-promotion-gates");
const SUMMARY_FILE = path.join(__dirname, "tradfi-promotion-gate-report.json");

const {
  loadConfig,
  shouldRunProfile,
  selectProfiles,
} = require("./run-tradfi-twelve-equities-backtests");
const {
  buildCandidateRows,
  summarizeCandidates,
} = require("./build-promotion-gate-report");

function getProfileMonteOutputPath(profile) {
  return path.join(OUTPUT_DIR, `${profile.label}.monte-carlo.json`);
}

function buildMonteProfileEnv(profile, outputFile, baseEnv = process.env) {
  return {
    ...baseEnv,
    EXTERNAL_HISTORY_PROVIDER: "twelvedata",
    EXTERNAL_HISTORY_TRADFI_ONLY: "1",
    MONTE_SYMBOLS: profile.symbols.join(","),
    MONTE_STRATEGIES: profile.strategies.join(","),
    MONTE_TF: String(profile.tf),
    MONTE_HTF_TF: String(profile.htfTf),
    MONTE_LTF_LIMIT: String(profile.ltfLimit),
    MONTE_HTF_LIMIT: String(profile.htfLimit),
    MONTE_CONFIG_OVERRIDES: JSON.stringify(profile.configOverrides || {}),
    MONTE_OUTPUT_FILE: outputFile,
  };
}

function sleep(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return;
  spawnSync("sleep", [String(Number(seconds))], { stdio: "inherit" });
}

function runProfileMonteCarlo(profile, baseEnv = process.env) {
  const outputFile = getProfileMonteOutputPath(profile);
  const env = buildMonteProfileEnv(profile, outputFile, baseEnv);

  console.log(`\n[TRADFI MONTE] ${profile.label}`);
  console.log(
    `symbols=${profile.symbols.join(",")} strategies=${profile.strategies.join(",")} tf=${profile.tf}/${profile.htfTf}`
  );

  const result = spawnSync(process.execPath, [MONTE_RUNNER], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    return {
      ok: false,
      outputFile,
      error: `TradFi Monte Carlo failed: ${profile.label}`,
      status: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    ok: true,
    outputFile,
  };
}

function buildSummaryReport(filePaths = [], failedProfiles = []) {
  const rows = filePaths.flatMap((filePath) => {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return buildCandidateRows(filePath, data).map((row) => ({
      ...row,
      profileLabel: path.basename(filePath).replace(/\.monte-carlo\.json$/i, ""),
    }));
  });

  const summary = summarizeCandidates(rows);

  return {
    generatedAt: new Date().toISOString(),
    files: filePaths,
    counts: {
      total: rows.length,
      core: summary.core.length,
      exploratory: summary.exploratory.length,
      reject: summary.reject.length,
      failedProfiles: failedProfiles.length,
    },
    failedProfiles,
    rows,
    summary,
  };
}

function main() {
  const includeObserve = String(process.env.TRADFI_PROMOTION_INCLUDE_OBSERVE || "0") === "1";
  const config = loadConfig(CONFIG_FILE);
  const profiles = selectProfiles(config, includeObserve);
  const cooldownSeconds = Number(
    process.env.TRADFI_PROMOTION_COOLDOWN_SECS || config.profileCooldownSeconds || 0
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputs = [];
  const failedProfiles = [];
  profiles.forEach((profile, index) => {
    const result = runProfileMonteCarlo(profile);
    if (result.ok) {
      outputs.push(result.outputFile);
    } else {
      failedProfiles.push({
        profileLabel: profile.label,
        mode: profile.mode,
        symbols: profile.symbols,
        strategies: profile.strategies,
        tf: profile.tf,
        htfTf: profile.htfTf,
        error: result.error,
      });
    }

    if (index < profiles.length - 1 && cooldownSeconds > 0) {
      console.log(`\n[COOLDOWN] waiting ${cooldownSeconds}s before next profile`);
      sleep(cooldownSeconds);
    }
  });

  const report = buildSummaryReport(outputs, failedProfiles);
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log(`\nSaved TradFi promotion report: ${SUMMARY_FILE}`);
  if (failedProfiles.length) {
    console.log(`\n[FAILED PROFILES] ${failedProfiles.length}`);
    failedProfiles.forEach((row) => {
      console.log(`${row.profileLabel}: ${row.error}`);
    });
  }
  for (const key of ["core", "exploratory", "reject"]) {
    console.log(`\n[${key.toUpperCase()}] ${report.summary[key].length}`);
    report.summary[key].slice(0, 10).forEach((row) => {
      console.log(
        `${row.profileLabel} ${row.strategy} ${row.symbols.join("+")} ${row.tf}/${row.htfTf} ` +
          `trades=${row.trades} avgNet=${row.avgNetPnlPct.toFixed(4)}% ` +
          `pf=${row.profitFactorNet.toFixed(3)} lowerAvg=${row.lowerBoundAvgNetPnlPct.toFixed(4)}% ` +
          `lowerPf=${row.lowerBoundProfitFactorNet.toFixed(3)} => ${row.promotionStatus}`
      );
    });
  }

  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  CONFIG_FILE,
  OUTPUT_DIR,
  SUMMARY_FILE,
  getProfileMonteOutputPath,
  buildMonteProfileEnv,
  buildSummaryReport,
};
