require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { RandomForestClassifier } = require("ml-random-forest");

const {
  fetchAvailableFuturesSymbols,
  fetchKlines,
} = require("./backtest-candidate-strategies");
const {
  calcEMASeries,
  calcRSISeries,
  calcATR,
  calcADX,
  calcBollingerBands,
  calcMACDSeries,
} = require("../indicators/market-indicators");

const DEFAULT_SYMBOLS = ["ADAUSDC", "LINKUSDC", "1000PEPEUSDC"];
const TF = process.env.PREDICT_NEXT3_TF || "5m";
const LTF_LIMIT = Number(process.env.PREDICT_NEXT3_LIMIT || 1200);
const HORIZON_BARS = Number(process.env.PREDICT_NEXT3_HORIZON_BARS || 3);
const LOOKBACK_BARS = Number(process.env.PREDICT_NEXT3_LOOKBACK_BARS || 20);
const ATR_PERIOD = Number(process.env.PREDICT_NEXT3_ATR_PERIOD || 14);
const ADX_PERIOD = Number(process.env.PREDICT_NEXT3_ADX_PERIOD || 14);
const RSI_PERIOD = Number(process.env.PREDICT_NEXT3_RSI_PERIOD || 14);
const BB_PERIOD = Number(process.env.PREDICT_NEXT3_BB_PERIOD || 20);
const FLAT_ATR_MULT = Number(process.env.PREDICT_NEXT3_FLAT_ATR_MULT || 0.35);
const MIN_MOVE_PCT = Number(process.env.PREDICT_NEXT3_MIN_MOVE_PCT || 0.05);
const TRAIN_RATIO = Number(process.env.PREDICT_NEXT3_TRAIN_RATIO || 0.60);
const VALID_RATIO = Number(process.env.PREDICT_NEXT3_VALID_RATIO || 0.20);
const TEST_RATIO = Number(process.env.PREDICT_NEXT3_TEST_RATIO || 0.20);
const MIN_ROWS = Number(process.env.PREDICT_NEXT3_MIN_ROWS || 300);
const MIN_WARMUP = Number(process.env.PREDICT_NEXT3_MIN_WARMUP || 240);
const LABELS = ["DOWN", "FLAT", "UP"];

function parseSymbolsOverride(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return null;

  const symbols = [...new Set(
    rawValue
      .split(",")
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  )];

  return symbols.length ? symbols : null;
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function round(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function safeDiv(numerator, denominator, fallback = 0) {
  const a = Number(numerator);
  const b = Number(denominator);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return fallback;
  return a / b;
}

function toPct(value, base) {
  return safeDiv(value, base, 0) * 100;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function stddev(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (Number(value || 0) - avg) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function maxValue(values) {
  return values.reduce((max, value) => (value > max ? value : max), -Infinity);
}

function minValue(values) {
  return values.reduce((min, value) => (value < min ? value : min), Infinity);
}

function oneHot(value, categories) {
  const arr = new Array(categories.length).fill(0);
  const idx = categories.indexOf(String(value));
  if (idx >= 0) arr[idx] = 1;
  return arr;
}

function encodeRow(row, featureColumns, encoders) {
  const vector = [];

  for (const column of featureColumns) {
    if (column === "symbol" || column === "tf") {
      vector.push(...oneHot(row[column], encoders[column]));
      continue;
    }

    vector.push(Number.isFinite(Number(row[column])) ? Number(row[column]) : 0);
  }

  return vector;
}

function alignShiftedSeries(series, index, shift) {
  if (!Array.isArray(series)) return null;
  const shiftedIndex = index - shift;
  if (shiftedIndex < 0 || shiftedIndex >= series.length) return null;
  const value = series[shiftedIndex];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function getCandleShape(candle, prevClose = null) {
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  const range = Math.max(1e-9, high - low);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  return {
    bodyPct: toPct(close - open, open),
    rangePct: toPct(high - low, open),
    upperWickFrac: safeDiv(upperWick, range, 0),
    lowerWickFrac: safeDiv(lowerWick, range, 0),
    closePos: safeDiv(close - low, range, 0.5),
    gapPct:
      Number.isFinite(Number(prevClose)) && Number(prevClose) !== 0
        ? toPct(open - prevClose, prevClose)
        : 0,
    bullish: close >= open ? 1 : 0,
  };
}

function labelFutureDirection({
  currentClose,
  futureClose,
  atrPct,
  flatAtrMult = FLAT_ATR_MULT,
  minMovePct = MIN_MOVE_PCT,
}) {
  const thresholdPct = Math.max(Number(minMovePct) || 0, (Number(atrPct) || 0) * Number(flatAtrMult));
  const futureDeltaPct = toPct(Number(futureClose) - Number(currentClose), Number(currentClose));

  if (futureDeltaPct > thresholdPct) {
    return {
      label: "UP",
      thresholdPct: round(thresholdPct, 6),
      futureDeltaPct: round(futureDeltaPct, 6),
    };
  }

  if (futureDeltaPct < -thresholdPct) {
    return {
      label: "DOWN",
      thresholdPct: round(thresholdPct, 6),
      futureDeltaPct: round(futureDeltaPct, 6),
    };
  }

  return {
    label: "FLAT",
    thresholdPct: round(thresholdPct, 6),
    futureDeltaPct: round(futureDeltaPct, 6),
  };
}

function buildFeatureRow({ symbol, tf, candles, closes, volumes, ema20, ema50, ema200, rsiSeries, macdSeries }, index) {
  if (index < Math.max(MIN_WARMUP, LOOKBACK_BARS - 1)) return null;
  if (index + HORIZON_BARS >= candles.length) return null;

  const current = candles[index];
  const currentClose = Number(current.close);
  const closeWindow5 = closes.slice(index - 4, index + 1);
  const closeWindow10 = closes.slice(index - 9, index + 1);
  const closeWindow20 = closes.slice(index - 19, index + 1);
  const recentCandles20 = candles.slice(index - 19, index + 1);
  const recentCandles50 = candles.slice(index - 49, index + 1);
  const recentCandles30 = candles.slice(index - 29, index + 1);
  const recentCandles5 = candles.slice(index - 4, index + 1);
  const recentCandles10 = candles.slice(index - 9, index + 1);
  const recentVolumes20 = volumes.slice(index - 19, index + 1);
  const recentVolumes5 = volumes.slice(index - 4, index + 1);
  const returns5 = closeWindow5.slice(1).map((value, offset) => toPct(value - closeWindow5[offset], closeWindow5[offset]));
  const returns10 = closeWindow10.slice(1).map((value, offset) => toPct(value - closeWindow10[offset], closeWindow10[offset]));
  const avgVol20 = mean(recentVolumes20);
  const avgVol5 = mean(recentVolumes5);
  const avgRange20 = mean(recentCandles20.map((candle) => Number(candle.high) - Number(candle.low)));
  const avgRange5 = mean(recentCandles5.map((candle) => Number(candle.high) - Number(candle.low)));
  const atr = calcATR(recentCandles30, ATR_PERIOD);
  const atrPct = Number.isFinite(atr) ? toPct(atr, currentClose) : 0;
  const adx = calcADX(recentCandles50, ADX_PERIOD);
  const bb = calcBollingerBands(closeWindow20, BB_PERIOD, 2);
  const bbWidthPct =
    bb && Number.isFinite(bb.basis) && bb.basis !== 0
      ? toPct(bb.upper - bb.lower, bb.basis)
      : 0;
  const bbClosePos =
    bb && Number.isFinite(bb.upper) && Number.isFinite(bb.lower) && bb.upper !== bb.lower
      ? safeDiv(currentClose - bb.lower, bb.upper - bb.lower, 0.5)
      : 0.5;
  const candleFeatures = {};

  for (let back = 0; back < 5; back += 1) {
    const candle = candles[index - back];
    const previous = candles[index - back - 1];
    const shape = getCandleShape(candle, previous?.close ?? candle.open);
    candleFeatures[`c${back}_bodyPct`] = round(shape.bodyPct, 6);
    candleFeatures[`c${back}_rangePct`] = round(shape.rangePct, 6);
    candleFeatures[`c${back}_upperWickFrac`] = round(shape.upperWickFrac, 6);
    candleFeatures[`c${back}_lowerWickFrac`] = round(shape.lowerWickFrac, 6);
    candleFeatures[`c${back}_closePos`] = round(shape.closePos, 6);
    candleFeatures[`c${back}_gapPct`] = round(shape.gapPct, 6);
    candleFeatures[`c${back}_bullish`] = shape.bullish;
  }

  const future = labelFutureDirection({
    currentClose,
    futureClose: candles[index + HORIZON_BARS].close,
    atrPct,
  });

  return {
    symbol,
    tf,
    candleIndex: index,
    signalTs: Number(current.closeTime),
    signalIso: new Date(Number(current.closeTime)).toISOString(),
    close: round(currentClose, 8),
    atrPct: round(atrPct, 6) ?? 0,
    adx: round(adx, 6) ?? 0,
    rsi: round(alignShiftedSeries(rsiSeries, index, RSI_PERIOD), 6) ?? 0,
    rsiDelta3:
      round(
        (alignShiftedSeries(rsiSeries, index, RSI_PERIOD) ?? 0) -
          (alignShiftedSeries(rsiSeries, index - 3, RSI_PERIOD) ?? 0),
        6
      ) ?? 0,
    ema20DistPct: round(toPct(currentClose - (ema20[index] ?? currentClose), currentClose), 6) ?? 0,
    ema50DistPct: round(toPct(currentClose - (ema50[index] ?? currentClose), currentClose), 6) ?? 0,
    ema200DistPct: round(toPct(currentClose - (ema200[index] ?? currentClose), currentClose), 6) ?? 0,
    ema20Over50Pct: round(toPct((ema20[index] ?? currentClose) - (ema50[index] ?? currentClose), currentClose), 6) ?? 0,
    ema50Over200Pct: round(toPct((ema50[index] ?? currentClose) - (ema200[index] ?? currentClose), currentClose), 6) ?? 0,
    ema20Slope3Pct:
      round(
        toPct(
          (ema20[index] ?? currentClose) - (ema20[index - 3] ?? ema20[index] ?? currentClose),
          currentClose
        ),
        6
      ) ?? 0,
    ret1Pct: round(toPct(closes[index] - closes[index - 1], closes[index - 1]), 6) ?? 0,
    ret3Pct: round(toPct(closes[index] - closes[index - 3], closes[index - 3]), 6) ?? 0,
    ret5Pct: round(toPct(closes[index] - closes[index - 5], closes[index - 5]), 6) ?? 0,
    ret10Pct: round(toPct(closes[index] - closes[index - 10], closes[index - 10]), 6) ?? 0,
    realizedVol5Pct: round(stddev(returns5), 6) ?? 0,
    realizedVol10Pct: round(stddev(returns10), 6) ?? 0,
    avgBody5Pct:
      round(
        mean(recentCandles5.map((candle) => Math.abs(toPct(Number(candle.close) - Number(candle.open), Number(candle.open))))),
        6
      ) ?? 0,
    bullishCount5: recentCandles5.reduce(
      (sum, candle) => sum + (Number(candle.close) >= Number(candle.open) ? 1 : 0),
      0
    ),
    rangeWidth5Pct:
      round(
        toPct(
          maxValue(recentCandles5.map((candle) => Number(candle.high))) -
            minValue(recentCandles5.map((candle) => Number(candle.low))),
          currentClose
        ),
        6
      ) ?? 0,
    rangeWidth10Pct:
      round(
        toPct(
          maxValue(recentCandles10.map((candle) => Number(candle.high))) -
            minValue(recentCandles10.map((candle) => Number(candle.low))),
          currentClose
        ),
        6
      ) ?? 0,
    compression5v20: round(safeDiv(avgRange5, avgRange20, 0), 6) ?? 0,
    volumeRatio1: round(safeDiv(Number(current.volume), avgVol20, 0), 6) ?? 0,
    volumeRatio5: round(safeDiv(avgVol5, avgVol20, 0), 6) ?? 0,
    bbWidthPct: round(bbWidthPct, 6) ?? 0,
    bbClosePos: round(bbClosePos, 6) ?? 0,
    macdHist: round(macdSeries[index]?.hist, 8) ?? 0,
    macdHistDelta3:
      round((macdSeries[index]?.hist ?? 0) - (macdSeries[index - 3]?.hist ?? 0), 8) ?? 0,
    labelThresholdPct: future.thresholdPct,
    futureDeltaPct: future.futureDeltaPct,
    targetLabel: future.label,
    targetClassIndex: LABELS.indexOf(future.label),
    ...candleFeatures,
  };
}

function inferFeatureColumns(rows) {
  const ignore = new Set([
    "candleIndex",
    "signalTs",
    "signalIso",
    "close",
    "labelThresholdPct",
    "futureDeltaPct",
    "targetLabel",
    "targetClassIndex",
  ]);

  return Object.keys(rows[0] || {}).filter((key) => !ignore.has(key));
}

function temporalSplit(rows) {
  const total = rows.length;
  const trainEnd = Math.floor(total * TRAIN_RATIO);
  const validEnd = Math.floor(total * (TRAIN_RATIO + VALID_RATIO));

  return {
    train: rows.slice(0, trainEnd),
    valid: rows.slice(trainEnd, validEnd),
    test: rows.slice(validEnd),
  };
}

function buildEncoders(rows) {
  return {
    symbol: [...new Set(rows.map((row) => row.symbol))].sort(),
    tf: [...new Set(rows.map((row) => row.tf))].sort(),
  };
}

function balanceRowsByClass(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = row.targetClassIndex;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const classRows = [...grouped.values()];
  if (classRows.length < 2) return rows;

  const maxSize = Math.max(...classRows.map((items) => items.length));
  const balanced = [];

  for (const items of classRows) {
    if (items.length === 0) continue;
    for (let i = 0; i < maxSize; i += 1) {
      balanced.push(items[i % items.length]);
    }
  }

  return balanced;
}

function buildConfusionMatrix(classLabels, yTrue, yPred) {
  const matrix = {};

  for (const actual of classLabels) {
    matrix[actual] = {};
    for (const predicted of classLabels) {
      matrix[actual][predicted] = 0;
    }
  }

  for (let i = 0; i < yTrue.length; i += 1) {
    const actual = classLabels[yTrue[i]];
    const predicted = classLabels[yPred[i]];
    matrix[actual][predicted] += 1;
  }

  return matrix;
}

function evaluateMulticlass(yTrue, yPred, classLabels = LABELS) {
  const confusion = buildConfusionMatrix(classLabels, yTrue, yPred);
  const perClass = {};
  let correct = 0;

  for (let i = 0; i < yTrue.length; i += 1) {
    if (yTrue[i] === yPred[i]) correct += 1;
  }

  for (let classIndex = 0; classIndex < classLabels.length; classIndex += 1) {
    const label = classLabels[classIndex];
    const tp = confusion[label][label];
    let fp = 0;
    let fn = 0;

    for (const otherLabel of classLabels) {
      if (otherLabel !== label) {
        fp += confusion[otherLabel][label];
        fn += confusion[label][otherLabel];
      }
    }

    const precision = safeDiv(tp, tp + fp, 0);
    const recall = safeDiv(tp, tp + fn, 0);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    perClass[label] = {
      tp,
      fp,
      fn,
      precision: round(precision, 6),
      recall: round(recall, 6),
      f1: round(f1, 6),
    };
  }

  const macroF1 = mean(Object.values(perClass).map((metrics) => metrics.f1));
  const balancedAccuracy = mean(Object.values(perClass).map((metrics) => metrics.recall));

  return {
    accuracy: round(safeDiv(correct, yTrue.length, 0), 6),
    macroF1: round(macroF1, 6),
    balancedAccuracy: round(balancedAccuracy, 6),
    confusion,
    perClass,
  };
}

function trainAndSelectModel(trainRows, validRows, featureColumns, encoders) {
  const candidateParams = [
    { nEstimators: 60, maxDepth: 6, minNumSamples: 6 },
    { nEstimators: 90, maxDepth: 8, minNumSamples: 5 },
    { nEstimators: 120, maxDepth: 10, minNumSamples: 4 },
  ];

  let best = null;

  for (const params of candidateParams) {
    const trainBalanced = balanceRowsByClass(trainRows);
    const Xtrain = trainBalanced.map((row) => encodeRow(row, featureColumns, encoders));
    const ytrain = trainBalanced.map((row) => row.targetClassIndex);
    const Xvalid = validRows.map((row) => encodeRow(row, featureColumns, encoders));
    const yvalid = validRows.map((row) => row.targetClassIndex);

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

    const ypred = rf.predict(Xvalid);
    const metrics = evaluateMulticlass(yvalid, ypred);
    const score = metrics.macroF1 * 0.7 + metrics.accuracy * 0.2 + metrics.balancedAccuracy * 0.1;

    if (!best || score > best.score) {
      best = {
        score,
        params,
        metricsValidation: metrics,
      };
    }
  }

  return best;
}

function buildClassCounts(rows) {
  const counts = { DOWN: 0, FLAT: 0, UP: 0 };
  for (const row of rows) {
    counts[row.targetLabel] += 1;
  }
  return counts;
}

function predictProbabilities(classifier, vector) {
  const probabilities = {};

  for (let classIndex = 0; classIndex < LABELS.length; classIndex += 1) {
    probabilities[LABELS[classIndex]] = round(
      classifier.predictProbability([vector], classIndex)[0],
      6
    );
  }

  return probabilities;
}

function buildBaselineMajority(trainRows, rows) {
  const counts = buildClassCounts(trainRows);
  const majorityLabel = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const majorityIndex = LABELS.indexOf(majorityLabel);
  return rows.map(() => majorityIndex);
}

function buildBaselineMomentum(rows) {
  return rows.map((row) => {
    if (row.ret1Pct > row.labelThresholdPct) return LABELS.indexOf("UP");
    if (row.ret1Pct < -row.labelThresholdPct) return LABELS.indexOf("DOWN");
    return LABELS.indexOf("FLAT");
  });
}

function perSymbolMetrics(rows, predictedIndexes) {
  const grouped = new Map();

  rows.forEach((row, idx) => {
    if (!grouped.has(row.symbol)) grouped.set(row.symbol, { rows: [], yPred: [] });
    grouped.get(row.symbol).rows.push(row);
    grouped.get(row.symbol).yPred.push(predictedIndexes[idx]);
  });

  const out = {};

  for (const [symbol, value] of grouped.entries()) {
    out[symbol] = {
      rows: value.rows.length,
      metrics: evaluateMulticlass(
        value.rows.map((row) => row.targetClassIndex),
        value.yPred
      ),
    };
  }

  return out;
}

function toCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          if (value === null || value === undefined) return "";
          const text = typeof value === "object" ? JSON.stringify(value) : String(value);
          if (text.includes(",") || text.includes('"') || text.includes("\n")) {
            return `"${text.replace(/"/g, '""')}"`;
          }
          return text;
        })
        .join(",")
    ),
  ].join("\n");
}

async function loadDataset() {
  const requestedSymbols =
    parseSymbolsOverride(process.env.PREDICT_NEXT3_SYMBOLS || process.env.BACKTEST_SYMBOLS) ||
    DEFAULT_SYMBOLS;
  const availableSymbols = await fetchAvailableFuturesSymbols();
  const symbols = requestedSymbols.filter((symbol) => availableSymbols.has(symbol));
  const rows = [];

  if (!symbols.length) {
    throw new Error(`Nenhum símbolo válido disponível. Pedidos: ${requestedSymbols.join(", ")}`);
  }

  for (const symbol of symbols) {
    console.log(`[NEXT3] loading ${symbol} ${TF} limit=${LTF_LIMIT}`);
    const candles = await fetchKlines(symbol, TF, LTF_LIMIT);
    const closes = candles.map((candle) => Number(candle.close));
    const volumes = candles.map((candle) => Number(candle.volume));
    const ema20 = calcEMASeries(closes, 20);
    const ema50 = calcEMASeries(closes, 50);
    const ema200 = calcEMASeries(closes, 200);
    const rsiSeries = calcRSISeries(closes, RSI_PERIOD);
    const macdSeries = calcMACDSeries(closes, 12, 26, 9);

    let symbolRows = 0;
    for (let index = 0; index < candles.length; index += 1) {
      const row = buildFeatureRow(
        {
          symbol,
          tf: TF,
          candles,
          closes,
          volumes,
          ema20,
          ema50,
          ema200,
          rsiSeries,
          macdSeries,
        },
        index
      );

      if (row) {
        rows.push(row);
        symbolRows += 1;
      }
    }

    console.log(`[NEXT3] built rows for ${symbol}: ${symbolRows}`);
  }

  rows.sort((a, b) => a.signalTs - b.signalTs);
  return { symbols, rows };
}

async function main() {
  const { symbols, rows } = await loadDataset();
  const symbolSlug = safeSlug(symbols.join("-"));
  const tfSlug = safeSlug(TF);
  const outputJson =
    process.env.PREDICT_NEXT3_OUTPUT_JSON ||
    path.join(__dirname, `next-3-candles-direction-${symbolSlug}-${tfSlug}-report.json`);
  const outputCsv =
    process.env.PREDICT_NEXT3_OUTPUT_CSV ||
    path.join(
      __dirname,
      `next-3-candles-direction-${symbolSlug}-${tfSlug}-test-predictions.csv`
    );

  if (rows.length < MIN_ROWS) {
    throw new Error(`Poucos rows para a experiência: ${rows.length}`);
  }

  const featureColumns = inferFeatureColumns(rows);
  const { train, valid, test } = temporalSplit(rows);

  if (!train.length || !valid.length || !test.length) {
    throw new Error("Split temporal inválido para a experiência next-3-candles.");
  }

  const encoders = buildEncoders(train);
  const selected = trainAndSelectModel(train, valid, featureColumns, encoders);
  const finalTrainRows = balanceRowsByClass([...train, ...valid]);
  const Xtrain = finalTrainRows.map((row) => encodeRow(row, featureColumns, encoders));
  const ytrain = finalTrainRows.map((row) => row.targetClassIndex);
  const Xtest = test.map((row) => encodeRow(row, featureColumns, encoders));
  const ytest = test.map((row) => row.targetClassIndex);

  const rf = new RandomForestClassifier({
    nEstimators: selected.params.nEstimators,
    maxFeatures: Math.max(1, Math.floor(Math.sqrt(Xtrain[0].length))),
    replacement: true,
    seed: 42,
    treeOptions: {
      maxDepth: selected.params.maxDepth,
      minNumSamples: selected.params.minNumSamples,
    },
  });

  rf.train(Xtrain, ytrain);

  const testPredictions = rf.predict(Xtest);
  const metricsTest = evaluateMulticlass(ytest, testPredictions);
  const majorityPredictions = buildBaselineMajority(train, test);
  const momentumPredictions = buildBaselineMomentum(test);
  const baselineMajorityMetrics = evaluateMulticlass(ytest, majorityPredictions);
  const baselineMomentumMetrics = evaluateMulticlass(ytest, momentumPredictions);
  const latestPredictions = {};

  for (const symbol of symbols) {
    const latestRow = [...rows].reverse().find((row) => row.symbol === symbol);
    if (!latestRow) continue;
    const vector = encodeRow(latestRow, featureColumns, encoders);
    const classIndex = rf.predict([vector])[0];
    latestPredictions[symbol] = {
      tf: TF,
      signalIso: latestRow.signalIso,
      prediction: LABELS[classIndex],
      probabilities: predictProbabilities(rf, vector),
      lastClose: latestRow.close,
      currentAtrPct: latestRow.atrPct,
      flatThresholdPct: latestRow.labelThresholdPct,
      ret1Pct: latestRow.ret1Pct,
      ret3Pct: latestRow.ret3Pct,
      compression5v20: latestRow.compression5v20,
      bbWidthPct: latestRow.bbWidthPct,
      rsi: latestRow.rsi,
    };
  }

  const testRowsForCsv = test.map((row, index) => {
    const probabilities = predictProbabilities(rf, Xtest[index]);
    return {
      signalIso: row.signalIso,
      symbol: row.symbol,
      tf: row.tf,
      target: row.targetLabel,
      prediction: LABELS[testPredictions[index]],
      pDown: probabilities.DOWN,
      pFlat: probabilities.FLAT,
      pUp: probabilities.UP,
      ret1Pct: row.ret1Pct,
      ret3Pct: row.ret3Pct,
      atrPct: row.atrPct,
      thresholdPct: row.labelThresholdPct,
      futureDeltaPct: row.futureDeltaPct,
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    config: {
      symbols,
      tf: TF,
      ltfLimit: LTF_LIMIT,
      horizonBars: HORIZON_BARS,
      lookbackBars: LOOKBACK_BARS,
      atrPeriod: ATR_PERIOD,
      adxPeriod: ADX_PERIOD,
      rsiPeriod: RSI_PERIOD,
      flatAtrMult: FLAT_ATR_MULT,
      minMovePct: MIN_MOVE_PCT,
      split: {
        trainRatio: TRAIN_RATIO,
        validRatio: VALID_RATIO,
        testRatio: TEST_RATIO,
      },
      targetDefinition:
        "UP/DOWN/FLAT pela variação do close atual até ao close 3 candles à frente, com banda FLAT baseada em max(minMovePct, atrPct * flatAtrMult).",
    },
    dataset: {
      rowsTotal: rows.length,
      train: train.length,
      valid: valid.length,
      test: test.length,
      classCountsTrain: buildClassCounts(train),
      classCountsValid: buildClassCounts(valid),
      classCountsTest: buildClassCounts(test),
    },
    featureColumns,
    encoders,
    selectedParams: selected.params,
    metricsValidation: selected.metricsValidation,
    metricsTest,
    baselineMajorityMetrics,
    baselineMomentumMetrics,
    perSymbolTest: perSymbolMetrics(test, testPredictions),
    latestPredictions,
  };

  fs.writeFileSync(outputJson, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(outputCsv, toCsv(testRowsForCsv), "utf8");

  console.log("\n=== NEXT 3 CANDLES DIRECTION LAB ===");
  console.log(`Symbols: ${symbols.join(", ")}`);
  console.log(`TF: ${TF}`);
  console.log(`Rows: ${rows.length} | Train=${train.length} Valid=${valid.length} Test=${test.length}`);
  console.log("Validation metrics:", JSON.stringify(selected.metricsValidation, null, 2));
  console.log("Test metrics:", JSON.stringify(metricsTest, null, 2));
  console.log("Baseline majority:", JSON.stringify(baselineMajorityMetrics, null, 2));
  console.log("Baseline momentum:", JSON.stringify(baselineMomentumMetrics, null, 2));
  console.log("Latest predictions:", JSON.stringify(latestPredictions, null, 2));
  console.log(`Report saved to: ${outputJson}`);
  console.log(`Test predictions CSV: ${outputCsv}`);
}

module.exports = {
  LABELS,
  labelFutureDirection,
  buildFeatureRow,
  evaluateMulticlass,
  buildBaselineMomentum,
};

if (require.main === module) {
  main().catch((error) => {
    console.error("[NEXT3][ERROR]", error?.stack || error?.message || error);
    process.exit(1);
  });
}
