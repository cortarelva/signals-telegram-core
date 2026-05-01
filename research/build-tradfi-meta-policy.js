require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("../runtime/file-utils");

const COMBINED_SUMMARY_FILE = process.env.TRADFI_META_COMBINED_SUMMARY_FILE
  ? path.resolve(process.cwd(), process.env.TRADFI_META_COMBINED_SUMMARY_FILE)
  : path.join(
      __dirname,
      "meta-models-tradfi",
      "equities_reversal_1h_1d_core",
      "oversold-bounce-combined-summary.json"
    );
const OUTPUT_FILE = process.env.TRADFI_META_POLICY_FILE
  ? path.resolve(process.cwd(), process.env.TRADFI_META_POLICY_FILE)
  : path.join(__dirname, "tradfi-twelve-equities-paper-policy.json");

const CORE_MIN_TEST_F1 = Number(process.env.TRADFI_META_CORE_MIN_TEST_F1 || 0.55);
const CORE_MIN_ROWS = Number(process.env.TRADFI_META_CORE_MIN_ROWS || 90);
const OBSERVE_MIN_TEST_F1 = Number(process.env.TRADFI_META_OBSERVE_MIN_TEST_F1 || 0.4);
const OBSERVE_MIN_ROWS = Number(process.env.TRADFI_META_OBSERVE_MIN_ROWS || 80);
const DEFAULT_MIN_PROBABILITY = Number(process.env.TRADFI_META_DEFAULT_MIN_PROBABILITY || 0.55);

function buildDecision(result) {
  const testF1 = Number(result?.metricsTest?.f1 || 0);
  const validF1 = Number(result?.metricsValidation?.f1 || 0);
  const rows = Number(result?.rows || 0);
  const symbol = result?.symbol || "UNKNOWN";

  if (symbol === "ALL") {
    return {
      status: "fallback",
      reason: "aggregate_reference_model",
    };
  }

  if (rows >= CORE_MIN_ROWS && testF1 >= CORE_MIN_TEST_F1) {
    return {
      status: "core",
      reason: "symbol_model_beats_core_threshold",
    };
  }

  if (rows >= OBSERVE_MIN_ROWS && testF1 >= OBSERVE_MIN_TEST_F1) {
    return {
      status: "observe",
      reason: "symbol_model_promising_but_not_core",
    };
  }

  return {
    status: "disabled",
    reason: "symbol_model_below_observe_threshold",
    validF1,
  };
}

function buildPolicy(summary) {
  const results = Array.isArray(summary?.results) ? summary.results : [];
  const aggregate = results.find((item) => item.symbol === "ALL") || null;
  const symbolResults = results.filter((item) => item.symbol && item.symbol !== "ALL");

  const symbols = {};
  for (const result of symbolResults) {
    const decision = buildDecision(result);
    symbols[result.symbol] = {
      status: decision.status,
      reason: decision.reason,
      rows: result.rows,
      minProbability: DEFAULT_MIN_PROBABILITY,
      metricsValidation: result.metricsValidation || null,
      metricsTest: result.metricsTest || null,
      modelFile: result.modelFile || null,
      fallbackModelFile: aggregate?.modelFile || null,
      fallbackStatus: aggregate ? "available" : "missing",
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceSummaryFile: COMBINED_SUMMARY_FILE,
    profileLabel: summary?.profileLabel || null,
    strategy: summary?.strategy || null,
    thresholds: {
      core: {
        minRows: CORE_MIN_ROWS,
        minTestF1: CORE_MIN_TEST_F1,
      },
      observe: {
        minRows: OBSERVE_MIN_ROWS,
        minTestF1: OBSERVE_MIN_TEST_F1,
      },
      minProbability: DEFAULT_MIN_PROBABILITY,
    },
    aggregateModel: aggregate
      ? {
          rows: aggregate.rows,
          metricsValidation: aggregate.metricsValidation || null,
          metricsTest: aggregate.metricsTest || null,
          modelFile: aggregate.modelFile || null,
        }
      : null,
    symbols,
  };
}

function main() {
  if (!fs.existsSync(COMBINED_SUMMARY_FILE)) {
    throw new Error(`Combined summary not found: ${COMBINED_SUMMARY_FILE}`);
  }

  const summary = JSON.parse(fs.readFileSync(COMBINED_SUMMARY_FILE, "utf8"));
  const policy = buildPolicy(summary);
  writeJsonAtomic(OUTPUT_FILE, policy);

  const symbolEntries = Object.entries(policy.symbols);
  console.log(
    `[TRADFI_META_POLICY] symbols=${symbolEntries.length} output=${OUTPUT_FILE}`
  );
  for (const [symbol, item] of symbolEntries) {
    const testF1 = Number(item?.metricsTest?.f1 || 0);
    console.log(
      `[TRADFI_META_POLICY] ${symbol} status=${item.status} rows=${item.rows} testF1=${testF1.toFixed(4)}`
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDecision,
  buildPolicy,
};
