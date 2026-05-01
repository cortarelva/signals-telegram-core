const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isContinuationStrategy,
  computeContinuationRank,
  rankExecutionCandidates,
} = require("../runtime/continuation-ranker");

function makeCandidate({
  symbol,
  strategy,
  score,
  rrPlanned,
  adx,
  nearPullback = true,
  bullish = true,
  direction = "LONG",
  metaModelProbability = null,
  selectedMinScore = 60,
}) {
  return {
    symbol,
    selectedStrategy: strategy,
    selectedMinScore,
    signalObj: {
      symbol,
      strategy,
      direction,
      score,
      rrPlanned,
      adx,
      nearPullback,
      bullish,
      metaModelProbability,
    },
  };
}

test("isContinuationStrategy recognizes cipher and ignition families", () => {
  assert.equal(isContinuationStrategy("cipherContinuationLong"), true);
  assert.equal(isContinuationStrategy("cipherContinuationShort"), true);
  assert.equal(isContinuationStrategy("ignitionContinuationLong"), true);
  assert.equal(isContinuationStrategy("trend"), false);
});

test("computeContinuationRank rewards stronger continuation context", () => {
  const weaker = makeCandidate({
    symbol: "ADAUSDC",
    strategy: "cipherContinuationLong",
    score: 70,
    rrPlanned: 0.9,
    adx: 16,
    metaModelProbability: 0.56,
  });
  const stronger = makeCandidate({
    symbol: "LINKUSDC",
    strategy: "cipherContinuationLong",
    score: 82,
    rrPlanned: 1.25,
    adx: 24,
    metaModelProbability: 0.68,
  });

  assert.ok(computeContinuationRank(stronger) > computeContinuationRank(weaker));
});

test("rankExecutionCandidates keeps best continuation candidate and leaves others alone", () => {
  const trendCandidate = makeCandidate({
    symbol: "BTCUSDC",
    strategy: "trend",
    score: 77,
    rrPlanned: 1.1,
    adx: 22,
  });
  const ada = makeCandidate({
    symbol: "ADAUSDC",
    strategy: "cipherContinuationLong",
    score: 74,
    rrPlanned: 1.02,
    adx: 18,
    metaModelProbability: 0.59,
  });
  const link = makeCandidate({
    symbol: "LINKUSDC",
    strategy: "cipherContinuationLong",
    score: 83,
    rrPlanned: 1.28,
    adx: 26,
    metaModelProbability: 0.69,
  });

  const ranked = rankExecutionCandidates([trendCandidate, ada, link], {
    enabled: true,
    maxContinuationPerCycle: 1,
  });

  assert.equal(ranked.selected.length, 2);
  assert.equal(ranked.rejected.length, 1);
  assert.ok(ranked.selected.includes(trendCandidate));
  assert.ok(ranked.selected.includes(link));
  assert.ok(ranked.rejected.includes(ada));
  assert.equal(link.continuationRank, 1);
  assert.equal(ada.continuationRank, 2);
  assert.equal(link.continuationRankGroupSize, 2);
});
