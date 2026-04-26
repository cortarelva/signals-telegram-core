require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BACKTEST_RUNNER = path.join(__dirname, "backtest-candidate-strategies.js");
const DATASET_BUILDER = path.join(__dirname, "build-tradfi-meta-dataset.js");
const BASE_TRAINER = path.join(__dirname, "train-strategy-meta-models.js");
const {
  loadConfig,
  buildProfileEnv,
} = require("./run-tradfi-twelve-equities-backtests");

const PROFILE_LABEL = String(
  process.env.TRADFI_META_PROFILE_LABEL || "equities_reversal_1h_1d_core"
).trim();
const STRATEGY = String(process.env.TRADFI_META_STRATEGY || "oversoldBounce").trim();
const SPLIT_BY_SYMBOL = String(process.env.TRADFI_META_SPLIT_BY_SYMBOL || "0") === "1";

function findProfile(config, label = PROFILE_LABEL) {
  return (config?.profiles || []).find((profile) => profile.label === label) || null;
}

function getArtifactsDir(profileLabel = PROFILE_LABEL) {
  return path.join(__dirname, "meta-models-tradfi", profileLabel);
}

function sanitizeFileName(value) {
  return String(value || "dataset")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function getArtifacts(
  profileLabel = PROFILE_LABEL,
  strategy = STRATEGY,
  tf = "1h",
  htfTf = "1d",
  symbol = null
) {
  const artifactsDir = symbol
    ? path.join(getArtifactsDir(profileLabel), "by-symbol", sanitizeFileName(symbol))
    : getArtifactsDir(profileLabel);
  const datasetBase = sanitizeFileName(`${strategy}-${tf}-${htfTf}`);
  return {
    artifactsDir,
    fullBacktestFile: path.join(
      __dirname,
      "cache",
      "tradfi-twelve-equities-backtests",
      `${profileLabel}.full.json`
    ),
    datasetJson: path.join(artifactsDir, `${datasetBase}-dataset.json`),
    datasetCsv: path.join(artifactsDir, `${datasetBase}-dataset.csv`),
    datasetSummary: path.join(artifactsDir, `${datasetBase}-summary.json`),
  };
}

function runNodeScript(scriptPath, env) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Script failed: ${path.basename(scriptPath)}`);
  }
}

function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runTrainingTarget({
  profile,
  profileLabel = PROFILE_LABEL,
  strategy = STRATEGY,
  fullBacktestFile,
  symbol = null,
}) {
  const artifacts = getArtifacts(profileLabel, strategy, profile.tf, profile.htfTf, symbol);
  fs.mkdirSync(artifacts.artifactsDir, { recursive: true });

  const datasetEnv = {
    ...process.env,
    TRADFI_META_SOURCE_FILE: fullBacktestFile,
    TRADFI_META_STRATEGY: strategy,
    TRADFI_META_OUTPUT_DIR: artifacts.artifactsDir,
    ...(symbol ? { TRADFI_META_SYMBOLS: symbol } : {}),
  };

  const trainEnv = {
    ...process.env,
    META_DATA_FILE: artifacts.datasetJson,
    META_INCLUDE_REPLAY: "0",
    META_STRATEGIES: strategy,
    META_OUTPUT_DIR: artifacts.artifactsDir,
  };

  console.log(
    `[TRADFI_META] build dataset source=${fullBacktestFile}${symbol ? ` symbol=${symbol}` : ""}`
  );
  runNodeScript(DATASET_BUILDER, datasetEnv);

  console.log(
    `[TRADFI_META] train meta-model dataset=${artifacts.datasetJson}${symbol ? ` symbol=${symbol}` : ""}`
  );
  runNodeScript(BASE_TRAINER, trainEnv);

  return {
    symbol: symbol || "ALL",
    artifacts,
    datasetSummary: loadJsonIfExists(artifacts.datasetSummary),
    trainSummary: loadJsonIfExists(path.join(artifacts.artifactsDir, "summary.json")),
  };
}

function writeCombinedSummary(profileLabel, strategy, results) {
  const filePath = path.join(
    getArtifactsDir(profileLabel),
    `${sanitizeFileName(strategy)}-combined-summary.json`
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    profileLabel,
    strategy,
    results: results.map((result) => {
      const trained = result.trainSummary?.trained?.[0] || null;
      return {
        symbol: result.symbol,
        datasetSummaryFile: result.artifacts.datasetSummary,
        trainSummaryFile: path.join(result.artifacts.artifactsDir, "summary.json"),
        rows: result.datasetSummary?.totalRows ?? null,
        outcomes: result.datasetSummary?.outcomes ?? null,
        metricsValidation: trained?.metricsValidation || null,
        metricsTest: trained?.metricsTest || null,
        classCounts: trained?.classCounts || null,
        modelFile: trained?.filePath || null,
      };
    }),
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function main() {
  const config = loadConfig();
  const profile = findProfile(config, PROFILE_LABEL);

  if (!profile) {
    throw new Error(`TradFi profile not found: ${PROFILE_LABEL}`);
  }

  const artifacts = getArtifacts(PROFILE_LABEL, STRATEGY, profile.tf, profile.htfTf);
  fs.mkdirSync(artifacts.artifactsDir, { recursive: true });

  const backtestEnv = buildProfileEnv(profile, artifacts.fullBacktestFile, process.env);
  backtestEnv.BACKTEST_INCLUDE_TRADES = "1";

  console.log(`[TRADFI_META] backtest profile=${PROFILE_LABEL} strategy=${STRATEGY}`);
  runNodeScript(BACKTEST_RUNNER, backtestEnv);

  const results = [];
  results.push(
    runTrainingTarget({
      profile,
      profileLabel: PROFILE_LABEL,
      strategy: STRATEGY,
      fullBacktestFile: artifacts.fullBacktestFile,
    })
  );

  if (SPLIT_BY_SYMBOL) {
    for (const symbol of profile.symbols || []) {
      results.push(
        runTrainingTarget({
          profile,
          profileLabel: PROFILE_LABEL,
          strategy: STRATEGY,
          fullBacktestFile: artifacts.fullBacktestFile,
          symbol,
        })
      );
    }
  }

  const combinedSummaryFile = writeCombinedSummary(PROFILE_LABEL, STRATEGY, results);
  console.log(
    `[TRADFI_META] complete targets=${results.length} combinedSummary=${combinedSummaryFile}`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  findProfile,
  getArtifactsDir,
  getArtifacts,
  writeCombinedSummary,
};
