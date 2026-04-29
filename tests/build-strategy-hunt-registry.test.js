const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRegistry,
  renderMarkdown,
} = require("../research/build-strategy-hunt-registry");

test("buildRegistry prefers stronger candidate across profiles", () => {
  const reports = [
    {
      profile: "narrow",
      generatedAt: "2026-04-29T10:00:00.000Z",
      source: "/tmp/narrow.json",
      candidates: [
        {
          symbol: "BTCUSDC",
          tf: "1h",
          strategy: "breakdownRetestShort",
          classification: { status: "observe" },
          summary: { trades: 12, avgNetPnlPct: 0.12, profitFactorNet: 1.2, maxDrawdownPct: 4 },
        },
      ],
    },
    {
      profile: "broad",
      generatedAt: "2026-04-29T22:00:00.000Z",
      source: "/tmp/broad.json",
      candidates: [
        {
          symbol: "BTCUSDC",
          tf: "1h",
          strategy: "breakdownRetestShort",
          classification: { status: "live" },
          summary: { trades: 20, avgNetPnlPct: 0.2, profitFactorNet: 1.5, maxDrawdownPct: 3 },
        },
        {
          symbol: "SOLUSDC",
          tf: "15m",
          strategy: "oversoldBounce",
          classification: { status: "archive" },
          summary: { trades: 40, avgNetPnlPct: -0.1, profitFactorNet: 0.8, maxDrawdownPct: 10 },
        },
      ],
    },
  ];

  const registry = buildRegistry(reports);
  assert.equal(registry.counts.live, 1);
  assert.equal(registry.counts.archive, 1);
  assert.equal(registry.candidates.length, 2);
  assert.equal(registry.candidates[0].profile, "broad");
  assert.equal(registry.candidates[0].symbol, "BTCUSDC");
});

test("renderMarkdown includes counts and top candidates", () => {
  const md = renderMarkdown({
    generatedAt: "2026-04-29T22:00:00.000Z",
    counts: { live: 1, observe: 2, archive: 3 },
    profiles: [{ profile: "narrow", candidateCount: 4, generatedAt: "x" }],
    topCandidates: [
      {
        symbol: "BTCUSDC",
        tf: "1h",
        strategy: "breakdownRetestShort",
        profile: "narrow",
        classification: { status: "observe" },
        summary: { trades: 13, avgNetPnlPct: 0.19, profitFactorNet: 1.39, maxDrawdownPct: 3.7 },
      },
    ],
  });

  assert.match(md, /live: 1/);
  assert.match(md, /BTCUSDC 1h breakdownRetestShort/);
});
