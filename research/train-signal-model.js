const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { RandomForestClassifier } = require("ml-random-forest");

const CSV_FILE = path.join(__dirname, "consolidated-trades.csv");
const MODEL_FILE = path.join(__dirname, "signal-model.json");
const META_FILE = path.join(__dirname, "signal-model-meta.json");

const MIN_ROWS = 50;
const TARGET_PNL_PCT = 0.10;
const TRAIN_RATIO = 0.60;
const VALID_RATIO = 0.20;
const TEST_RATIO = 0.20;

const FEATURE_COLUMNS = [
  "symbol",
  "tf",
  "score",
  "rsi",
  "prevRsi",
  "rsiDelta",
  "atr",
  "atrPct",
  "adx",
  "ema20",
  "ema50",
  "ema200",
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
  "distToEma20Atr",
  "distToEma50Atr",
  "priceAboveEma20",
  "priceAboveEma50",
  "priceAboveEma200",
  "rrPlanned",
];

const BOOL_COLUMNS = new Set([
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
]);

const CATEGORICAL_COLUMNS = new Set(["symbol", "tf"]);

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function detectTimeValue(row) {
  const candidates = [
    "signalTs",
    "openTs",
    "closedTs",
    "entryTransactTime",
    "exitTransactTime",
    "execMetricTs",
    "entryTime",
    "openTime",
    "createdAt",
    "timestamp",
    "time",
    "date",
    "datetime",
    "ts",
  ];

  for (const key of candidates) {
    const value = row[key];
    if (value === undefined || value === null || value === "") continue;

    if (typeof value === "number") {
      if (value > 1e12) return value;
      if (value > 1e9) return value * 1000;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();

      const num = Number(trimmed);
      if (Number.isFinite(num)) {
        if (num > 1e12) return num;
        if (num > 1e9) return num * 1000;
      }

      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function enrichRow(row) {
  const rsi = toNumber(row.rsi);
  const prevRsi = toNumber(row.prevRsi);
  const atr = toNumber(row.atr);
  const distToEma20 = toNumber(row.distToEma20);
  const distToEma50 = toNumber(row.distToEma50);
  const ema20 = toNumber(row.ema20);
  const ema50 = toNumber(row.ema50);
  const ema200 = toNumber(row.ema200);

  // usar entry em vez de entryFill para evitar leakage da execução
  const entry = toNumber(row.entry);

  return {
    ...row,
    timeValue: detectTimeValue(row),
    rsiDelta:
      rsi !== null && prevRsi !== null ? rsi - prevRsi : null,
    distToEma20Atr:
      atr !== null && atr > 0 && distToEma20 !== null ? distToEma20 / atr : null,
    distToEma50Atr:
      atr !== null && atr > 0 && distToEma50 !== null ? distToEma50 / atr : null,
    priceAboveEma20:
      entry !== null && ema20 !== null ? (entry > ema20 ? 1 : 0) : null,
    priceAboveEma50:
      entry !== null && ema50 !== null ? (entry > ema50 ? 1 : 0) : null,
    priceAboveEma200:
      entry !== null && ema200 !== null ? (entry > ema200 ? 1 : 0) : null,
  };
}

function buildCategoryMap(rows, column) {
  const values = new Set();
  for (const row of rows) {
    const v = row[column];
    if (v !== null && v !== undefined && v !== "") values.add(String(v));
  }
  return Array.from(values).sort();
}

function buildEncoders(rows) {
  return {
    symbol: buildCategoryMap(rows, "symbol"),
    tf: buildCategoryMap(rows, "tf"),
  };
}

function oneHot(value, categories) {
  const arr = new Array(categories.length).fill(0);
  const idx = categories.indexOf(String(value));
  if (idx >= 0) arr[idx] = 1;
  return arr;
}

function encodeRow(row, encoders) {
  const vector = [];

  for (const col of FEATURE_COLUMNS) {
    if (CATEGORICAL_COLUMNS.has(col)) {
      vector.push(...oneHot(row[col], encoders[col]));
      continue;
    }

    if (BOOL_COLUMNS.has(col)) {
      const v = toBoolNumber(row[col]);
      vector.push(v ?? 0);
      continue;
    }

    const v = toNumber(row[col]);
    vector.push(v ?? 0);
  }

  return vector;
}

function loadRows() {
  const csv = fs.readFileSync(CSV_FILE, "utf8");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });

  const clean = rows
    .map((row, idx) => {
      const pnlPct = toNumber(row.pnlPct);
      if (pnlPct === null) return null;

      const enriched = enrichRow(row);

      return {
        ...enriched,
        _rowIndex: idx,
        pnlPct,
        target: pnlPct > TARGET_PNL_PCT ? 1 : 0,
      };
    })
    .filter(Boolean);

  const withTime = clean.filter((row) => row.timeValue !== null);

  console.log("Total rows parsed:", rows.length);
  console.log("Rows with pnlPct:", clean.length);
  console.log("Rows with valid time:", withTime.length);
  console.log("Sample columns:", Object.keys(rows[0] || {}));

  // usa tempo real se existir em parte suficiente do dataset
  if (withTime.length >= Math.max(30, Math.floor(clean.length * 0.8))) {
    return withTime.sort((a, b) => a.timeValue - b.timeValue);
  }

  console.warn(
    "Aviso: sem coluna temporal parseável suficiente; a usar ordem original do CSV."
  );

  return clean.sort((a, b) => a._rowIndex - b._rowIndex);
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

function evaluate(yTrue, yPred) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (let i = 0; i < yTrue.length; i++) {
    const a = yTrue[i];
    const b = yPred[i];

    if (a === 1 && b === 1) tp++;
    else if (a === 0 && b === 0) tn++;
    else if (a === 0 && b === 1) fp++;
    else if (a === 1 && b === 0) fn++;
  }

  const accuracy = (tp + tn) / Math.max(1, yTrue.length);
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 =
    (2 * precision * recall) / Math.max(1e-9, precision + recall);

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
    if (row.target === 1) positives++;
    else negatives++;
  }

  return { positives, negatives };
}

function balanceTrainRows(rows) {
  const positives = rows.filter((r) => r.target === 1);
  const negatives = rows.filter((r) => r.target === 0);

  if (positives.length === 0 || negatives.length === 0) return rows;

  let major;
  let minor;

  if (positives.length >= negatives.length) {
    major = positives;
    minor = negatives;
  } else {
    major = negatives;
    minor = positives;
  }

  const replicatedMinor = [];
  let i = 0;

  while (replicatedMinor.length < major.length) {
    replicatedMinor.push(minor[i % minor.length]);
    i++;
  }

  return [...major, ...replicatedMinor];
}

function trainAndSelectModel(trainRows, validRows, encoders) {
  const candidates = [
    { nEstimators: 100, maxDepth: 6, minNumSamples: 5 },
    { nEstimators: 200, maxDepth: 8, minNumSamples: 5 },
    { nEstimators: 300, maxDepth: 10, minNumSamples: 4 },
  ];

  let best = null;

  for (const params of candidates) {
    const trainBalanced = balanceTrainRows(trainRows);

    const Xtrain = trainBalanced.map((r) => encodeRow(r, encoders));
    const ytrain = trainBalanced.map((r) => r.target);

    const Xvalid = validRows.map((r) => encodeRow(r, encoders));
    const yvalid = validRows.map((r) => r.target);

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

    const ypredValid = rf.predict(Xvalid);
    const metricsValid = evaluate(yvalid, ypredValid);

    const score =
      metricsValid.f1 * 0.60 +
      metricsValid.recall * 0.30 +
      metricsValid.precision * 0.10;

    if (!best || score > best.score) {
      best = {
        score,
        params,
        rf,
        metricsValid,
      };
    }
  }

  return best;
}

function printMetrics(label, metrics) {
  console.log(`\n=== ${label} ===`);
  console.log(`Accuracy:   ${metrics.accuracy.toFixed(4)}`);
  console.log(`Precision:  ${metrics.precision.toFixed(4)}`);
  console.log(`Recall:     ${metrics.recall.toFixed(4)}`);
  console.log(`F1:         ${metrics.f1.toFixed(4)}`);
  console.log(
    `Confusion:  TP=${metrics.tp} TN=${metrics.tn} FP=${metrics.fp} FN=${metrics.fn}`
  );
}

function main() {
  if (!fs.existsSync(CSV_FILE)) {
    throw new Error(`CSV não encontrado: ${CSV_FILE}`);
  }

  const rows = loadRows();
    printTargetDistributionByChunk(rows, 5);
  if (rows.length < MIN_ROWS) {
    throw new Error(`Poucos dados para treino: ${rows.length}`);
  }

  const { train, valid, test } = temporalSplit(rows);

  if (!train.length || !valid.length || !test.length) {
    throw new Error("Split temporal inválido. Verifica o tamanho do dataset.");
  }

  const encoders = buildEncoders(train);

  const trainCounts = classCounts(train);
  const validCounts = classCounts(valid);
  const testCounts = classCounts(test);

  console.log("\n=== DATASET ===");
  console.log(`Rows total: ${rows.length}`);
  console.log(`Train:      ${train.length}`);
  console.log(`Valid:      ${valid.length}`);
  console.log(`Test:       ${test.length}`);
  console.log(`Target pnl: > ${TARGET_PNL_PCT}`);

  console.log("\n=== CLASSES ===");
  console.log(
    `Train -> pos=${trainCounts.positives} neg=${trainCounts.negatives}`
  );
  console.log(
    `Valid -> pos=${validCounts.positives} neg=${validCounts.negatives}`
  );
  console.log(
    `Test  -> pos=${testCounts.positives} neg=${testCounts.negatives}`
  );

  const selected = trainAndSelectModel(train, valid, encoders);

  printMetrics("VALIDAÇÃO", selected.metricsValid);
  console.log("\nMelhores params:", selected.params);

  const finalTrainRows = balanceTrainRows([...train, ...valid]);
  const Xfinal = finalTrainRows.map((r) => encodeRow(r, encoders));
  const yfinal = finalTrainRows.map((r) => r.target);

  const Xtest = test.map((r) => encodeRow(r, encoders));
  const ytest = test.map((r) => r.target);

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

  const ypredTest = finalRf.predict(Xtest);
  const metricsTest = evaluate(ytest, ypredTest);

  printMetrics("TESTE FINAL", metricsTest);

  const payload = {
    modelType: "RandomForestClassifier",
    targetDefinition: {
      field: "pnlPct",
      positiveIfGreaterThan: TARGET_PNL_PCT,
    },
    split: {
      type: "temporal_or_csv_order_fallback",
      trainRatio: TRAIN_RATIO,
      validRatio: VALID_RATIO,
      testRatio: TEST_RATIO,
    },
    selectedParams: selected.params,
    featureColumns: FEATURE_COLUMNS,
    encoders,
    model: finalRf.toJSON(),
    metricsValidation: selected.metricsValid,
    metricsTest,
    rowsTotal: rows.length,
    rowsTrain: train.length,
    rowsValid: valid.length,
    rowsTest: test.length,
    classCounts: {
      train: trainCounts,
      valid: validCounts,
      test: testCounts,
    },
  };

  function printTargetDistributionByChunk(rows, chunks = 5) {
  const size = Math.ceil(rows.length / chunks);

  console.log(`\n=== TARGET DISTRIBUTION BY ${chunks} CHUNKS ===`);

  for (let i = 0; i < chunks; i++) {
    const start = i * size;
    const end = Math.min(rows.length, start + size);
    const slice = rows.slice(start, end);

    if (!slice.length) continue;

    const pos = slice.filter((r) => r.target === 1).length;
    const neg = slice.length - pos;
    const rate = pos / slice.length;

    console.log(
      `Chunk ${i + 1}: rows=${slice.length} pos=${pos} neg=${neg} posRate=${rate.toFixed(4)}`
    );
  }
}

  fs.writeFileSync(MODEL_FILE, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(
    META_FILE,
    JSON.stringify(
      {
        targetDefinition: payload.targetDefinition,
        split: payload.split,
        selectedParams: payload.selectedParams,
        featureColumns: FEATURE_COLUMNS,
        encoders,
        metricsValidation: selected.metricsValidation,
        metricsTest: payload.metricsTest,
        classCounts: payload.classCounts,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\nModelo guardado em: ${MODEL_FILE}`);
  console.log(`Meta guardada em:   ${META_FILE}`);
  console.log("Sample signalTs:", rows[0]?.signalTs);
console.log("Sample openTs:", rows[0]?.openTs);
console.log("Sample closedTs:", rows[0]?.closedTs);
}

main();