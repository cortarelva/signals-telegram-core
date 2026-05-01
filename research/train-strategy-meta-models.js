const fs = require("fs");
const path = require("path");
const { RandomForestClassifier } = require("ml-random-forest");
const { writeJsonAtomic } = require("../runtime/file-utils");

const DATA_FILE = process.env.META_DATA_FILE
  ? path.resolve(process.cwd(), process.env.META_DATA_FILE)
  : path.join(__dirname, "candidate-labeled-setups.json");
const REPLAY_FILE = process.env.META_REPLAY_FILE
  ? path.resolve(process.cwd(), process.env.META_REPLAY_FILE)
  : path.join(__dirname, "historical-replay-candidates.json");
const OUTPUT_DIR = process.env.META_OUTPUT_DIR
  ? path.resolve(process.cwd(), process.env.META_OUTPUT_DIR)
  : path.join(__dirname, "meta-models");
const SUMMARY_FILE = path.join(OUTPUT_DIR, "summary.json");

const TRAIN_RATIO = 0.6;
const VALID_RATIO = 0.2;
const TEST_RATIO = 0.2;
const TARGET_MIN_PNL_PCT = Number(process.env.META_TARGET_MIN_PNL_PCT || 0.02);
const MIN_ROWS = Number(process.env.META_MIN_ROWS || 25);
const MIN_POSITIVES = Number(process.env.META_MIN_POSITIVES || 5);
const MIN_NEGATIVES = Number(process.env.META_MIN_NEGATIVES || 5);
const MIN_TRAIN_ROWS = Number(process.env.META_MIN_TRAIN_ROWS || 10);
const MIN_VALID_ROWS = Number(process.env.META_MIN_VALID_ROWS || 5);
const MIN_TEST_ROWS = Number(process.env.META_MIN_TEST_ROWS || 5);
const INCLUDE_REPLAY = String(process.env.META_INCLUDE_REPLAY || "1") !== "0";

const BASE_FEATURE_COLUMNS = [
  "symbol",
  "tf",
  "direction",
  "signalClass",
  "score",
  "minScore",
  "rsi",
  "prevRsi",
  "atr",
  "atrPct",
  "adx",
  "bullish",
  "bullishFast",
  "nearEma20",
  "nearEma50",
  "nearPullback",
  "stackedEma",
  "rsiInBand",
  "rsiRising",
  "isTrend",
  "isRange",
  "emaSeparationPct",
  "emaSlopePct",
  "distToEma20",
  "distToEma50",
  "distanceToSupportAtr",
  "distanceToResistanceAtr",
  "riskAbs",
  "rewardAbs",
  "rrPlanned",
  "srPassed",
];

const EXCLUDED_COLUMNS = new Set([
  "sourceIndex",
  "signalTs",
  "signalIso",
  "signalCandleCloseTime",
  "signalCandleCloseIso",
  "strategy",
  "selectedStrategy",
  "selectedDirection",
  "selectedCandidate",
  "decisionReason",
  "candidateReason",
  "executionAttempted",
  "executionApproved",
  "executionReason",
  "executionOrderId",
  "allowed",
  "price",
  "entry",
  "sl",
  "tp",
  "tpRawAtr",
  "tpCappedByResistance",
  "tpCappedBySupport",
  "nearestSupport",
  "nearestResistance",
  "referenceCandleCloseTime",
  "referenceCandleCloseIso",
  "labelOutcome",
  "labelBucket",
  "labelTpHit",
  "labelSlHit",
  "labelTimeout",
  "labelAmbiguous",
  "barsObserved",
  "barsToOutcome",
  "labelOutcomeTs",
  "labelOutcomeIso",
  "labelOutcomePrice",
  "labelRealizedPnlPct",
  "labelTimeoutPnlPct",
  "labelMfePct",
  "labelMaePct",
  "labelMfeR",
  "labelMaeR",
  "sourceType",
]);

const BASE_CATEGORICAL_COLUMNS = new Set(["symbol", "tf", "direction", "signalClass"]);

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolNumber(value) {
  if (
    value === true ||
    value === "true" ||
    value === "TRUE" ||
    value === 1 ||
    value === "1"
  ) {
    return 1;
  }

  if (
    value === false ||
    value === "false" ||
    value === "FALSE" ||
    value === 0 ||
    value === "0"
  ) {
    return 0;
  }

  return null;
}

function sanitizeFileName(value) {
  return String(value || "model")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function buildTrainingRowKey(row) {
  const signalTime = Number(row.signalCandleCloseTime || row.signalTs || 0);
  const strategy = String(row.strategy || "");
  const symbol = String(row.symbol || "");
  const tf = String(row.tf || "");
  const direction = String(row.direction || "");
  const entry = Number(row.entry || 0);
  const sl = Number(row.sl || 0);
  const tp = Number(row.tp || 0);

  return [symbol, tf, strategy, direction, signalTime, entry, sl, tp].join("|");
}

function loadRows() {
  const dataFiles = [DATA_FILE];
  if (INCLUDE_REPLAY && fs.existsSync(REPLAY_FILE)) {
    dataFiles.push(REPLAY_FILE);
  }

  const rows = [];
  const seen = new Set();
  const sourceCounts = {};

  for (const filePath of dataFiles) {
    if (!fs.existsSync(filePath)) {
      if (filePath === DATA_FILE) {
        throw new Error(`Dataset não encontrado: ${DATA_FILE}`);
      }
      continue;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error(`${path.basename(filePath)} deve conter um array.`);
    }

    sourceCounts[path.basename(filePath)] = parsed.length;

    for (const row of parsed) {
      const key = buildTrainingRowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        ...row,
        sourceDataset: path.basename(filePath),
      });
    }
  }

  return {
    rows,
    dataFiles,
    sourceCounts,
  };
}

function getRequestedStrategies(rows) {
  const envValue = String(process.env.META_STRATEGIES || "").trim();
  if (envValue) {
    return envValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return Array.from(new Set(rows.map((row) => row.strategy).filter(Boolean))).sort();
}

function temporalSplit(rows) {
  const n = rows.length;
  const trainEnd = Math.floor(n * TRAIN_RATIO);
  const validEnd = Math.floor(n * (TRAIN_RATIO + VALID_RATIO));

  return {
    train: rows.slice(0, trainEnd),
    valid: rows.slice(trainEnd, validEnd),
    test: rows.slice(validEnd),
  };
}

function hasBothClasses(rows) {
  const counts = classCounts(rows);
  return counts.positives > 0 && counts.negatives > 0;
}

function findTemporalSplit(rows) {
  const defaults = temporalSplit(rows);

  if (
    defaults.train.length >= MIN_TRAIN_ROWS &&
    defaults.valid.length >= MIN_VALID_ROWS &&
    defaults.test.length >= MIN_TEST_ROWS &&
    hasBothClasses(defaults.train) &&
    hasBothClasses(defaults.valid) &&
    hasBothClasses(defaults.test)
  ) {
    return {
      ...defaults,
      mode: "default",
    };
  }

  const n = rows.length;
  let best = null;

  for (
    let trainEnd = MIN_TRAIN_ROWS;
    trainEnd <= n - MIN_VALID_ROWS - MIN_TEST_ROWS;
    trainEnd += 1
  ) {
    for (
      let validEnd = trainEnd + MIN_VALID_ROWS;
      validEnd <= n - MIN_TEST_ROWS;
      validEnd += 1
    ) {
      const train = rows.slice(0, trainEnd);
      const valid = rows.slice(trainEnd, validEnd);
      const test = rows.slice(validEnd);

      if (
        train.length < MIN_TRAIN_ROWS ||
        valid.length < MIN_VALID_ROWS ||
        test.length < MIN_TEST_ROWS
      ) {
        continue;
      }

      if (!hasBothClasses(train) || !hasBothClasses(valid) || !hasBothClasses(test)) {
        continue;
      }

      const trainRatio = train.length / n;
      const validRatio = valid.length / n;
      const testRatio = test.length / n;
      const score =
        Math.abs(trainRatio - TRAIN_RATIO) +
        Math.abs(validRatio - VALID_RATIO) +
        Math.abs(testRatio - TEST_RATIO);

      if (!best || score < best.score) {
        best = {
          train,
          valid,
          test,
          mode: "adaptive",
          score,
        };
      }
    }
  }

  return best;
}

function evaluate(yTrue, yPred) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (let i = 0; i < yTrue.length; i += 1) {
    const actual = yTrue[i];
    const predicted = yPred[i];

    if (actual === 1 && predicted === 1) tp += 1;
    else if (actual === 0 && predicted === 0) tn += 1;
    else if (actual === 0 && predicted === 1) fp += 1;
    else if (actual === 1 && predicted === 0) fn += 1;
  }

  const accuracy = (tp + tn) / Math.max(1, yTrue.length);
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);

  return {
    tp,
    tn,
    fp,
    fn,
    accuracy,
    precision,
    recall,
    f1,
  };
}

function classCounts(rows) {
  let positives = 0;
  let negatives = 0;

  for (const row of rows) {
    if (row.target === 1) positives += 1;
    else negatives += 1;
  }

  return { positives, negatives };
}

function balanceTrainRows(rows) {
  const positives = rows.filter((row) => row.target === 1);
  const negatives = rows.filter((row) => row.target === 0);

  if (positives.length === 0 || negatives.length === 0) return rows;

  const major = positives.length >= negatives.length ? positives : negatives;
  const minor = positives.length >= negatives.length ? negatives : positives;
  const replicatedMinor = [];

  for (let i = 0; replicatedMinor.length < major.length; i += 1) {
    replicatedMinor.push(minor[i % minor.length]);
  }

  return [...major, ...replicatedMinor];
}

function hasVariation(rows, column) {
  const values = new Set();

  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined || value === "") continue;
    values.add(String(value));
    if (values.size > 1) return true;
  }

  return false;
}

function isBooleanColumn(rows, column) {
  let seen = 0;

  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined || value === "") continue;

    if (toBoolNumber(value) === null) {
      return false;
    }

    seen += 1;
  }

  return seen > 0;
}

function isCategoricalColumn(rows, column) {
  let seen = 0;

  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined || value === "") continue;

    if (typeof value === "boolean") {
      seen += 1;
      continue;
    }

    if (typeof value === "number") {
      return false;
    }

    if (typeof value === "string") {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        return false;
      }
      seen += 1;
      continue;
    }

    return false;
  }

  return seen > 0;
}

function buildFeatureColumns(rows) {
  const metaColumns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => {
        if (key.startsWith("candidateMeta_") && !EXCLUDED_COLUMNS.has(key)) {
          set.add(key);
        }
      });
      return set;
    }, new Set())
  )
    .filter((column) => hasVariation(rows, column))
    .sort();

  return [...BASE_FEATURE_COLUMNS, ...metaColumns].filter(
    (column) => !EXCLUDED_COLUMNS.has(column) && hasVariation(rows, column)
  );
}

function buildColumnKinds(rows, featureColumns) {
  const categoricalColumns = new Set();
  const boolColumns = new Set();

  for (const column of featureColumns) {
    if (isBooleanColumn(rows, column)) {
      boolColumns.add(column);
      continue;
    }

    if (BASE_CATEGORICAL_COLUMNS.has(column) || isCategoricalColumn(rows, column)) {
      categoricalColumns.add(column);
    }
  }

  return {
    categoricalColumns: Array.from(categoricalColumns),
    boolColumns: Array.from(boolColumns),
  };
}

function buildCategoryMap(rows, column) {
  return Array.from(
    rows.reduce((set, row) => {
      const value = row[column];
      if (value !== null && value !== undefined && value !== "") {
        set.add(String(value));
      }
      return set;
    }, new Set())
  ).sort();
}

function buildEncoders(rows, categoricalColumns) {
  const encoders = {};

  for (const column of categoricalColumns) {
    encoders[column] = buildCategoryMap(rows, column);
  }

  return encoders;
}

function oneHot(value, categories) {
  const arr = new Array(categories.length).fill(0);
  const idx = categories.indexOf(String(value));
  if (idx >= 0) arr[idx] = 1;
  return arr;
}

function encodeRow(row, featureColumns, encoders, boolColumnsSet, categoricalColumnsSet) {
  const vector = [];

  for (const column of featureColumns) {
    if (categoricalColumnsSet.has(column)) {
      vector.push(...oneHot(row[column], encoders[column] || []));
      continue;
    }

    if (boolColumnsSet.has(column)) {
      vector.push(toBoolNumber(row[column]) ?? 0);
      continue;
    }

    vector.push(toNumber(row[column], 0) ?? 0);
  }

  return vector;
}

function trainAndSelectModel(trainRows, validRows, featureColumns, encoders, kinds) {
  const candidates = [
    { nEstimators: 100, maxDepth: 5, minNumSamples: 4 },
    { nEstimators: 200, maxDepth: 6, minNumSamples: 4 },
    { nEstimators: 300, maxDepth: 8, minNumSamples: 3 },
  ];

  const categoricalColumnsSet = new Set(kinds.categoricalColumns);
  const boolColumnsSet = new Set(kinds.boolColumns);
  let best = null;

  for (const params of candidates) {
    const balancedTrainRows = balanceTrainRows(trainRows);
    const Xtrain = balancedTrainRows.map((row) =>
      encodeRow(row, featureColumns, encoders, boolColumnsSet, categoricalColumnsSet)
    );
    const ytrain = balancedTrainRows.map((row) => row.target);

    const Xvalid = validRows.map((row) =>
      encodeRow(row, featureColumns, encoders, boolColumnsSet, categoricalColumnsSet)
    );
    const yvalid = validRows.map((row) => row.target);

    const rf = new RandomForestClassifier({
      nEstimators: params.nEstimators,
      maxFeatures: Math.max(1, Math.floor(Math.sqrt(Xtrain[0].length))),
      replacement: true,
      seed: 42,
      treeOptions: {
        maxDepth: params.maxDepth,
        minNumSamples: params.minNumSamples,
      },
    });

    rf.train(Xtrain, ytrain);

    const metricsValid = evaluate(yvalid, rf.predict(Xvalid));
    const score =
      metricsValid.f1 * 0.55 +
      metricsValid.precision * 0.25 +
      metricsValid.recall * 0.20;

    if (!best || score > best.score) {
      best = {
        score,
        params,
        metricsValid,
      };
    }
  }

  return best;
}

function prepareStrategyRows(rows, strategy) {
  return rows
    .filter((row) => row.strategy === strategy)
    .filter((row) => Number.isFinite(Number(row.signalCandleCloseTime || row.signalTs)))
    .filter((row) => Number.isFinite(Number(row.labelRealizedPnlPct)))
    .map((row) => ({
      ...row,
      timeValue: Number(row.signalCandleCloseTime || row.signalTs),
      target: Number(row.labelRealizedPnlPct) > TARGET_MIN_PNL_PCT ? 1 : 0,
    }))
    .sort((a, b) => a.timeValue - b.timeValue);
}

function writeModelFile(strategy, payload) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(
    OUTPUT_DIR,
    `${sanitizeFileName(strategy)}-meta-model.json`
  );
  writeJsonAtomic(filePath, payload);
  return filePath;
}

function trainStrategyModel(allRows, strategy) {
  const strategyRows = prepareStrategyRows(allRows, strategy);
  const totals = classCounts(strategyRows);

  if (strategyRows.length < MIN_ROWS) {
    return {
      strategy,
      status: "skipped",
      reason: `insufficient_rows:${strategyRows.length}`,
      rows: strategyRows.length,
      classCounts: totals,
    };
  }

  if (totals.positives < MIN_POSITIVES) {
    return {
      strategy,
      status: "skipped",
      reason: `insufficient_positives:${totals.positives}`,
      rows: strategyRows.length,
      classCounts: totals,
    };
  }

  if (totals.negatives < MIN_NEGATIVES) {
    return {
      strategy,
      status: "skipped",
      reason: `insufficient_negatives:${totals.negatives}`,
      rows: strategyRows.length,
      classCounts: totals,
    };
  }

  const split = findTemporalSplit(strategyRows);
  const { train, valid, test } = split || temporalSplit(strategyRows);
  const splitCounts = {
    train: classCounts(train),
    valid: classCounts(valid),
    test: classCounts(test),
  };

  if (!train.length || !valid.length || !test.length) {
    return {
      strategy,
      status: "skipped",
      reason: "invalid_temporal_split",
      rows: strategyRows.length,
      classCounts: totals,
    };
  }

  if (
    splitCounts.train.positives === 0 ||
    splitCounts.train.negatives === 0 ||
    splitCounts.valid.positives === 0 ||
    splitCounts.valid.negatives === 0 ||
    splitCounts.test.positives === 0 ||
    splitCounts.test.negatives === 0
  ) {
    return {
      strategy,
      status: "skipped",
      reason: "class_missing_in_split",
      rows: strategyRows.length,
      classCounts: totals,
      splitClassCounts: splitCounts,
      splitModeTried: split?.mode || "default",
    };
  }

  const featureColumns = buildFeatureColumns(train);
  const kinds = buildColumnKinds(train, featureColumns);
  const encoders = buildEncoders(train, kinds.categoricalColumns);
  const selected = trainAndSelectModel(train, valid, featureColumns, encoders, kinds);

  const categoricalColumnsSet = new Set(kinds.categoricalColumns);
  const boolColumnsSet = new Set(kinds.boolColumns);
  const finalTrainRows = balanceTrainRows([...train, ...valid]);
  const Xfinal = finalTrainRows.map((row) =>
    encodeRow(row, featureColumns, encoders, boolColumnsSet, categoricalColumnsSet)
  );
  const yfinal = finalTrainRows.map((row) => row.target);
  const Xtest = test.map((row) =>
    encodeRow(row, featureColumns, encoders, boolColumnsSet, categoricalColumnsSet)
  );
  const ytest = test.map((row) => row.target);

  const finalRf = new RandomForestClassifier({
    nEstimators: selected.params.nEstimators,
    maxFeatures: Math.max(1, Math.floor(Math.sqrt(Xfinal[0].length))),
    replacement: true,
    seed: 42,
    treeOptions: {
      maxDepth: selected.params.maxDepth,
      minNumSamples: selected.params.minNumSamples,
    },
  });

  finalRf.train(Xfinal, yfinal);

  const payload = {
    modelType: "RandomForestClassifier",
    strategy,
    targetDefinition: {
      field: "labelRealizedPnlPct",
      positiveIfGreaterThan: TARGET_MIN_PNL_PCT,
    },
    split: {
      type: "temporal",
      mode: split?.mode || "default",
      trainRatio: TRAIN_RATIO,
      validRatio: VALID_RATIO,
      testRatio: TEST_RATIO,
    },
    selectedParams: selected.params,
    featureColumns,
    categoricalColumns: kinds.categoricalColumns,
    boolColumns: kinds.boolColumns,
    encoders,
    model: finalRf.toJSON(),
    metricsValidation: selected.metricsValid,
    metricsTest: evaluate(ytest, finalRf.predict(Xtest)),
    rowsTotal: strategyRows.length,
    rowsTrain: train.length,
    rowsValid: valid.length,
    rowsTest: test.length,
    classCounts: {
      total: totals,
      train: splitCounts.train,
      valid: splitCounts.valid,
      test: splitCounts.test,
    },
  };

  const filePath = writeModelFile(strategy, payload);

  return {
    strategy,
    status: "trained",
    rows: strategyRows.length,
    filePath,
    classCounts: totals,
    metricsValidation: selected.metricsValid,
    metricsTest: payload.metricsTest,
    selectedParams: selected.params,
  };
}

function main() {
  const { rows: allRows, dataFiles, sourceCounts } = loadRows();
  const strategies = getRequestedStrategies(allRows);
  const results = strategies.map((strategy) => trainStrategyModel(allRows, strategy));

  const summary = {
    generatedAt: new Date().toISOString(),
    dataFiles,
    sourceCounts,
    outputDir: OUTPUT_DIR,
    targetMinPnlPct: TARGET_MIN_PNL_PCT,
    minRows: MIN_ROWS,
    minPositives: MIN_POSITIVES,
    minNegatives: MIN_NEGATIVES,
    strategiesRequested: strategies,
    trained: results.filter((result) => result.status === "trained"),
    skipped: results.filter((result) => result.status !== "trained"),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJsonAtomic(SUMMARY_FILE, summary);

  console.log(
    `[META_MODELS] trained=${summary.trained.length} skipped=${summary.skipped.length} summary=${SUMMARY_FILE}`
  );

  for (const item of summary.trained) {
    console.log(
      `[META_MODELS] ${item.strategy} rows=${item.rows} ` +
        `validF1=${item.metricsValidation.f1.toFixed(4)} ` +
        `testF1=${item.metricsTest.f1.toFixed(4)} file=${item.filePath}`
    );
  }

  for (const item of summary.skipped) {
    console.log(
      `[META_MODELS] ${item.strategy} skipped reason=${item.reason} rows=${item.rows}`
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  prepareStrategyRows,
  buildFeatureColumns,
  buildColumnKinds,
  buildTrainingRowKey,
  findTemporalSplit,
  sanitizeFileName,
};
