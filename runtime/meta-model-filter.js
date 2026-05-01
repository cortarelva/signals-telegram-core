const fs = require("fs");
const path = require("path");
const { RandomForestClassifier } = require("ml-random-forest");

const META_MODELS_DIR =
  process.env.META_MODELS_DIR || path.join(__dirname, "..", "research", "meta-models");
const META_MODEL_MIN_PROB = Number(process.env.META_MODEL_MIN_PROB || 0.55);
const META_MODEL_MIN_TEST_F1 = Number(process.env.META_MODEL_MIN_TEST_F1 || 0.25);

const bundleCache = new Map();

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

function flattenObject(prefix, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const flat = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === null || inner === undefined) continue;

    if (
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      Object.keys(inner).length > 0
    ) {
      Object.assign(flat, flattenObject(`${prefix}${key}_`, inner));
      continue;
    }

    flat[`${prefix}${key}`] = inner;
  }

  return flat;
}

function buildMetaModelFeatureRow({
  symbol,
  tf,
  strategy,
  direction,
  signalObj = {},
  candidate = {},
  activeSrEval = {},
  nearestSupport = null,
  nearestResistance = null,
}) {
  const entry = toNumber(signalObj.entry ?? candidate.entry);
  const sl = toNumber(signalObj.sl ?? candidate.sl);
  const tp = toNumber(signalObj.tp ?? candidate.tp);
  const riskAbs =
    Number.isFinite(entry) && Number.isFinite(sl) ? Math.abs(entry - sl) : null;
  const rewardAbs =
    Number.isFinite(entry) && Number.isFinite(tp) ? Math.abs(tp - entry) : null;

  return {
    symbol,
    tf,
    strategy,
    direction,
    signalTs: toNumber(signalObj.signalTs ?? signalObj.ts),
    signalCandleCloseTime: toNumber(signalObj.signalCandleCloseTime),
    score: toNumber(candidate.score ?? signalObj.score),
    signalClass: candidate.signalClass || signalObj.signalClass || null,
    minScore: toNumber(candidate.minScore),
    entry,
    sl,
    tp,
    tpRawAtr: toNumber(signalObj.tpRawAtr ?? candidate.tpRawAtr ?? candidate.rawTp),
    riskAbs,
    rewardAbs,
    rrPlanned: toNumber(
      signalObj.rrPlanned ?? candidate.meta?.plannedRr ?? candidate.meta?.rrPlanned
    ),
    rsi: toNumber(signalObj.rsi),
    prevRsi: toNumber(signalObj.prevRsi),
    atr: toNumber(signalObj.atr),
    atrPct: toNumber(signalObj.atrPct),
    adx: toNumber(signalObj.adx),
    ema20: toNumber(signalObj.ema20),
    ema50: toNumber(signalObj.ema50),
    ema200: toNumber(signalObj.ema200),
    bullish: signalObj.bullish === true,
    bullishFast: signalObj.bullishFast === true,
    nearEma20: signalObj.nearEma20 === true,
    nearEma50: signalObj.nearEma50 === true,
    nearPullback: signalObj.nearPullback === true,
    stackedEma: signalObj.stackedEma === true,
    rsiInBand: signalObj.rsiInBand === true,
    rsiRising: signalObj.rsiRising === true,
    isTrend: signalObj.isTrend === true,
    isRange: signalObj.isRange === true,
    emaSeparationPct: toNumber(signalObj.emaSeparationPct),
    emaSlopePct: toNumber(signalObj.emaSlopePct),
    distToEma20: toNumber(signalObj.distToEma20),
    distToEma50: toNumber(signalObj.distToEma50),
    nearestSupport: toNumber(nearestSupport?.price ?? signalObj.nearestSupport),
    nearestResistance: toNumber(
      nearestResistance?.price ?? signalObj.nearestResistance
    ),
    distanceToSupportAtr: toNumber(
      activeSrEval?.distanceToSupportAtr ?? signalObj.distanceToSupportAtr
    ),
    distanceToResistanceAtr: toNumber(
      activeSrEval?.distanceToResistanceAtr ?? signalObj.distanceToResistanceAtr
    ),
    srPassed:
      activeSrEval?.passed === true ||
      signalObj.srPassed === true ||
      signalObj.srSoftPassed === true,
    ...flattenObject("candidateMeta_", candidate.meta),
  };
}

function oneHot(value, categories) {
  const arr = new Array(categories.length).fill(0);
  const idx = categories.indexOf(String(value));
  if (idx >= 0) arr[idx] = 1;
  return arr;
}

function encodeMetaModelRow(row, bundle) {
  const categoricalColumnsSet = new Set(bundle.categoricalColumns || []);
  const boolColumnsSet = new Set(bundle.boolColumns || []);
  const featureColumns = bundle.featureColumns || [];
  const encoders = bundle.encoders || {};
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

function getMetaModelFile(strategy) {
  return path.join(
    META_MODELS_DIR,
    `${sanitizeFileName(strategy)}-meta-model.json`
  );
}

function loadMetaModelBundle(strategy) {
  const filePath = getMetaModelFile(strategy);

  if (bundleCache.has(filePath)) {
    return bundleCache.get(filePath);
  }

  if (!fs.existsSync(filePath)) {
    bundleCache.set(filePath, null);
    return null;
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const bundle = {
    ...payload,
    filePath,
    classifier: RandomForestClassifier.load(payload.model),
  };

  bundleCache.set(filePath, bundle);
  return bundle;
}

function evaluateMetaModelCandidate(input, options = {}) {
  const strategy = input?.strategy || input?.candidate?.strategy;
  if (!strategy) {
    return {
      applied: false,
      passed: true,
      reason: "missing_strategy",
    };
  }

  const bundle = loadMetaModelBundle(strategy);
  if (!bundle) {
    return {
      applied: false,
      passed: true,
      reason: "model_not_found",
      strategy,
    };
  }

  const modelTestF1 = toNumber(bundle.metricsTest?.f1, 0) ?? 0;
  const modelValidF1 = toNumber(bundle.metricsValidation?.f1, 0) ?? 0;
  const minTestF1 = Number(options.minTestF1 ?? META_MODEL_MIN_TEST_F1);
  const minProb = Number(options.minProbability ?? META_MODEL_MIN_PROB);

  if (modelTestF1 < minTestF1) {
    return {
      applied: false,
      passed: true,
      reason: "model_below_quality_threshold",
      strategy,
      modelTestF1,
      modelValidF1,
      minTestF1,
      filePath: bundle.filePath,
    };
  }

  const featureRow = buildMetaModelFeatureRow(input);
  const vector = encodeMetaModelRow(featureRow, bundle);
  const probability = bundle.classifier.predictProbability([vector], 1)[0];
  const predictedClass = bundle.classifier.predict([vector])[0];
  const passed = Number(probability) >= minProb;

  return {
    applied: true,
    passed,
    reason: passed ? "meta_model_approved" : "meta_model_rejected",
    strategy,
    filePath: bundle.filePath,
    probability: toNumber(probability, 0),
    predictedClass: toNumber(predictedClass, 0),
    threshold: minProb,
    modelTestF1,
    modelValidF1,
    featureRow,
  };
}

function clearMetaModelBundleCache() {
  bundleCache.clear();
}

module.exports = {
  buildMetaModelFeatureRow,
  encodeMetaModelRow,
  loadMetaModelBundle,
  evaluateMetaModelCandidate,
  clearMetaModelBundleCache,
  sanitizeFileName,
};
