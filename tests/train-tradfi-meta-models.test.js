const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  findProfile,
  getArtifactsDir,
  getArtifacts,
  writeCombinedSummary,
} = require("../research/train-tradfi-meta-models");

test("findProfile selects the requested TradFi profile", () => {
  const profile = findProfile(
    {
      profiles: [
        { label: "a", tf: "30m", htfTf: "1d" },
        { label: "equities_reversal_1h_1d_core", tf: "1h", htfTf: "1d" },
      ],
    },
    "equities_reversal_1h_1d_core"
  );

  assert.equal(profile.tf, "1h");
  assert.equal(profile.htfTf, "1d");
});

test("getArtifacts builds predictable file paths for the tradfi meta workflow", () => {
  const dir = getArtifactsDir("equities_reversal_1h_1d_core");
  const artifacts = getArtifacts(
    "equities_reversal_1h_1d_core",
    "oversoldBounce",
    "1h",
    "1d"
  );

  assert.match(dir, /research\/meta-models-tradfi\/equities_reversal_1h_1d_core$/);
  assert.match(
    artifacts.fullBacktestFile,
    /tradfi-twelve-equities-backtests\/equities_reversal_1h_1d_core\.full\.json$/
  );
  assert.match(
    artifacts.datasetJson,
    /equities_reversal_1h_1d_core\/oversold-bounce-1h-1d-dataset\.json$/
  );
});

test("getArtifacts nests per-symbol trainings under by-symbol folders", () => {
  const artifacts = getArtifacts(
    "equities_reversal_1h_1d_core",
    "oversoldBounce",
    "1h",
    "1d",
    "SPYUSDT"
  );

  assert.match(
    artifacts.datasetJson,
    /equities_reversal_1h_1d_core\/by-symbol\/spyusdt\/oversold-bounce-1h-1d-dataset\.json$/
  );
});

test("writeCombinedSummary stores comparable aggregate and symbol-level results", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tradfi-meta-summary-"));
  const cwd = process.cwd();
  const repoSummaryDir = path.join(
    __dirname,
    "..",
    "research",
    "meta-models-tradfi",
    "profile_a"
  );
  process.chdir(tmpRoot);

  try {
    const filePath = writeCombinedSummary("profile_a", "oversoldBounce", [
      {
        symbol: "ALL",
        artifacts: { datasetSummary: "/tmp/all-summary.json", artifactsDir: "/tmp/all" },
        datasetSummary: { totalRows: 10, outcomes: { TP: 5, SL: 5 } },
        trainSummary: {
          trained: [
            {
              metricsValidation: { f1: 0.4 },
              metricsTest: { f1: 0.35 },
              classCounts: { positives: 5, negatives: 5 },
              filePath: "/tmp/all/model.json",
            },
          ],
        },
      },
      {
        symbol: "SPYUSDT",
        artifacts: { datasetSummary: "/tmp/spy-summary.json", artifactsDir: "/tmp/spy" },
        datasetSummary: { totalRows: 9, outcomes: { TP: 5, SL: 4 } },
        trainSummary: {
          trained: [
            {
              metricsValidation: { f1: 0.5 },
              metricsTest: { f1: 0.45 },
              classCounts: { positives: 5, negatives: 4 },
              filePath: "/tmp/spy/model.json",
            },
          ],
        },
      },
    ]);

    const summary = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(summary.results.length, 2);
    assert.equal(summary.results[0].symbol, "ALL");
    assert.equal(summary.results[1].symbol, "SPYUSDT");
    assert.equal(summary.results[1].metricsTest.f1, 0.45);
  } finally {
    process.chdir(cwd);
    fs.rmSync(repoSummaryDir, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
