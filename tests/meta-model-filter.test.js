const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { RandomForestClassifier } = require("ml-random-forest");

function writeTempModel(strategy, payload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-model-filter-"));
  const filePath = path.join(tempDir, `${strategy}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { tempDir, filePath };
}

test("buildMetaModelFeatureRow maps runtime signal fields into model features", async () => {
  const {
    buildMetaModelFeatureRow,
  } = require("../runtime/meta-model-filter");

  const row = buildMetaModelFeatureRow({
    symbol: "ETHUSDC",
    tf: "5m",
    strategy: "cipherContinuationLong",
    direction: "LONG",
    signalObj: {
      signalTs: 1_000,
      signalCandleCloseTime: 900,
      score: 88,
      signalClass: "EXECUTABLE",
      entry: 100,
      sl: 99,
      tp: 102,
      rrPlanned: 2,
      rsi: 55,
      prevRsi: 52,
      atr: 1.2,
      atrPct: 0.01,
      adx: 28,
      bullish: true,
      nearPullback: true,
      isTrend: true,
      srPassed: true,
    },
    candidate: {
      minScore: 64,
      meta: {
        plannedRr: 2.1,
        ltf: { bullishShift: true },
      },
    },
    activeSrEval: {
      passed: true,
      distanceToSupportAtr: 0.7,
      distanceToResistanceAtr: 1.6,
    },
  });

  assert.equal(row.symbol, "ETHUSDC");
  assert.equal(row.tf, "5m");
  assert.equal(row.riskAbs, 1);
  assert.equal(row.rewardAbs, 2);
  assert.equal(row.candidateMeta_ltf_bullishShift, true);
  assert.equal(row.srPassed, true);
});

test("evaluateMetaModelCandidate approves high-probability candidates from a quality model", async () => {
  const originalDir = process.env.META_MODELS_DIR;
  const X = [
    [0.1, 10],
    [0.2, 12],
    [0.3, 14],
    [0.8, 30],
    [0.9, 32],
    [1.0, 35],
  ];
  const y = [0, 0, 0, 1, 1, 1];
  const rf = new RandomForestClassifier({
    nEstimators: 25,
    maxFeatures: 1,
    replacement: true,
    seed: 42,
    treeOptions: { maxDepth: 4, minNumSamples: 1 },
  });
  rf.train(X, y);

  const strategy = "cipher-continuation-long-meta-model";
  const { tempDir, filePath } = writeTempModel(strategy, {
    featureColumns: ["score", "adx"],
    categoricalColumns: [],
    boolColumns: [],
    encoders: {},
    metricsValidation: { f1: 0.6 },
    metricsTest: { f1: 0.5 },
    model: rf.toJSON(),
  });

  process.env.META_MODELS_DIR = tempDir;
  delete require.cache[require.resolve("../runtime/meta-model-filter")];
  const {
    evaluateMetaModelCandidate,
    clearMetaModelBundleCache,
  } = require("../runtime/meta-model-filter");

  const result = evaluateMetaModelCandidate(
    {
      strategy: "cipherContinuationLong",
      symbol: "ETHUSDC",
      tf: "5m",
      direction: "LONG",
      signalObj: { score: 0.95, adx: 34, entry: 100, sl: 99, tp: 102 },
      candidate: { strategy: "cipherContinuationLong" },
    },
    { minProbability: 0.5, minTestF1: 0.25 }
  );

  assert.equal(result.applied, true);
  assert.equal(result.passed, true);
  assert.equal(result.filePath, filePath);
  assert.equal(result.probability >= 0.5, true);

  clearMetaModelBundleCache();
  process.env.META_MODELS_DIR = originalDir;
});

test("evaluateMetaModelCandidate ignores weak models even if a file exists", async () => {
  const originalDir = process.env.META_MODELS_DIR;
  const X = [
    [0.1, 10],
    [0.2, 12],
    [0.3, 14],
    [0.8, 30],
    [0.9, 32],
    [1.0, 35],
  ];
  const y = [0, 0, 0, 1, 1, 1];
  const rf = new RandomForestClassifier({
    nEstimators: 25,
    maxFeatures: 1,
    replacement: true,
    seed: 42,
    treeOptions: { maxDepth: 4, minNumSamples: 1 },
  });
  rf.train(X, y);

  const strategy = "trend-meta-model";
  const { tempDir } = writeTempModel(strategy, {
    featureColumns: ["score", "adx"],
    categoricalColumns: [],
    boolColumns: [],
    encoders: {},
    metricsValidation: { f1: 0.2 },
    metricsTest: { f1: 0.0 },
    model: rf.toJSON(),
  });

  process.env.META_MODELS_DIR = tempDir;
  delete require.cache[require.resolve("../runtime/meta-model-filter")];
  const {
    evaluateMetaModelCandidate,
    clearMetaModelBundleCache,
  } = require("../runtime/meta-model-filter");

  const result = evaluateMetaModelCandidate(
    {
      strategy: "trend",
      symbol: "ETHUSDC",
      tf: "5m",
      direction: "LONG",
      signalObj: { score: 0.95, adx: 34, entry: 100, sl: 99, tp: 102 },
      candidate: { strategy: "trend" },
    },
    { minProbability: 0.5, minTestF1: 0.25 }
  );

  assert.equal(result.applied, false);
  assert.equal(result.passed, true);
  assert.equal(result.reason, "model_below_quality_threshold");

  clearMetaModelBundleCache();
  process.env.META_MODELS_DIR = originalDir;
});
