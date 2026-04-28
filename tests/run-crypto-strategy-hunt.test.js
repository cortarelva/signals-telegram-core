const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseList,
  classifyCandidate,
  flattenRankedOutput,
  buildSummary,
} = require("../research/run-crypto-strategy-hunt");

test("parseList returns unique trimmed entries with fallback support", () => {
  assert.deepEqual(parseList(" SOLUSDC,BNBUSDC,SOLUSDC "), [
    "SOLUSDC",
    "BNBUSDC",
  ]);
  assert.deepEqual(parseList("", ["ADAUSDC"]), ["ADAUSDC"]);
});

test("classifyCandidate separates live, observe and archive objectively", () => {
  assert.deepEqual(
    classifyCandidate({
      trades: 20,
      avgNetPnlPct: 0.08,
      profitFactorNet: 1.4,
      maxDrawdownPct: 4.5,
    }),
    { status: "live", reason: "meets_live_gate" }
  );

  assert.deepEqual(
    classifyCandidate({
      trades: 10,
      avgNetPnlPct: 0.03,
      profitFactorNet: 1.1,
      maxDrawdownPct: 10,
    }),
    { status: "observe", reason: "positive_but_not_live_grade" }
  );

  assert.deepEqual(
    classifyCandidate({
      trades: 4,
      avgNetPnlPct: 0.04,
      profitFactorNet: 1.02,
      maxDrawdownPct: 6,
    }),
    { status: "observe", reason: "positive_but_sample_short" }
  );

  assert.deepEqual(
    classifyCandidate({
      trades: 12,
      avgNetPnlPct: -0.01,
      profitFactorNet: 0.9,
      maxDrawdownPct: 7,
    }),
    { status: "archive", reason: "fails_profitability_gate" }
  );
});

test("flattenRankedOutput expands bySymbol rows into candidate entries", () => {
  const output = {
    ranked: [
      {
        strategy: "cipherContinuationLong",
        direction: "LONG",
        bySymbol: {
          ADAUSDC: {
            summary: {
              trades: 18,
              avgNetPnlPct: 0.05,
              profitFactorNet: 1.3,
              maxDrawdownPct: 4,
            },
            sampleTrades: [{ id: 1 }],
          },
        },
      },
    ],
  };

  const candidates = flattenRankedOutput(output, "5m", "1d");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].symbol, "ADAUSDC");
  assert.equal(candidates[0].strategy, "cipherContinuationLong");
  assert.equal(candidates[0].classification.status, "live");
});

test("buildSummary ranks live candidates ahead of observe/archive", () => {
  const summary = buildSummary([
    {
      symbol: "SOLUSDC",
      tf: "1h",
      strategy: "range",
      summary: { trades: 5, avgNetPnlPct: -0.1, profitFactorNet: 0.8, maxDrawdownPct: 8 },
      classification: { status: "archive", reason: "fails_profitability_gate" },
    },
    {
      symbol: "ADAUSDC",
      tf: "5m",
      strategy: "cipherContinuationLong",
      summary: { trades: 18, avgNetPnlPct: 0.05, profitFactorNet: 1.3, maxDrawdownPct: 4 },
      classification: { status: "live", reason: "meets_live_gate" },
    },
    {
      symbol: "XRPUSDC",
      tf: "1h",
      strategy: "liquiditySweepReclaimLong",
      summary: { trades: 7, avgNetPnlPct: 0.02, profitFactorNet: 1.05, maxDrawdownPct: 6 },
      classification: { status: "observe", reason: "positive_but_sample_short" },
    },
  ]);

  assert.deepEqual(summary.counts, { live: 1, observe: 1, archive: 1 });
  assert.equal(summary.topCandidates[0].symbol, "ADAUSDC");
  assert.equal(summary.topCandidates[1].symbol, "XRPUSDC");
  assert.equal(summary.topCandidates[2].symbol, "SOLUSDC");
});
