const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldRunProfile,
  selectProfiles,
  getProfileOutputPath,
  buildProfileEnv,
} = require("../research/run-tradfi-twelve-equities-backtests");

test("shouldRunProfile skips observe profiles unless explicitly included", () => {
  const core = {
    label: "core",
    mode: "core",
    symbols: ["AAPLUSDT"],
    strategies: ["oversoldBounce"],
  };
  const observe = {
    label: "observe",
    mode: "observe",
    symbols: ["AAPLUSDT"],
    strategies: ["failedBreakdown"],
  };

  assert.equal(shouldRunProfile(core, false), true);
  assert.equal(shouldRunProfile(observe, false), false);
  assert.equal(shouldRunProfile(observe, true), true);
});

test("selectProfiles filters invalid and observe profiles correctly", () => {
  const profiles = selectProfiles(
    {
      profiles: [
        { label: "core", mode: "core", symbols: ["QQQUSDT"], strategies: ["oversoldBounce"] },
        { label: "observe", mode: "observe", symbols: ["AAPLUSDT"], strategies: ["failedBreakdown"] },
        { label: "broken", mode: "core", symbols: [], strategies: [] },
      ],
    },
    false
  );

  assert.deepEqual(
    profiles.map((profile) => profile.label),
    ["core"]
  );
});

test("getProfileOutputPath writes each profile into the tradfi cache folder", () => {
  const output = getProfileOutputPath({ label: "qqq_breakdown_short_30m_1d_core" });
  assert.match(output, /tradfi-twelve-equities-backtests\/qqq_breakdown_short_30m_1d_core\.json$/);
});

test("buildProfileEnv wires a self-contained research backtest environment", () => {
  const env = buildProfileEnv(
    {
      label: "equities_reversal_1h_1d_core",
      tf: "1h",
      htfTf: "1d",
      ltfLimit: 2200,
      htfLimit: 400,
      symbols: ["AAPLUSDT", "QQQUSDT"],
      strategies: ["oversoldBounce"],
      configOverrides: {
        DEFAULTS: {
          OVERSOLD_BOUNCE: { enabled: true },
        },
      },
    },
    "/tmp/out.json",
    { PATH: process.env.PATH }
  );

  assert.equal(env.EXTERNAL_HISTORY_PROVIDER, "twelvedata");
  assert.equal(env.BACKTEST_SYMBOLS, "AAPLUSDT,QQQUSDT");
  assert.equal(env.BACKTEST_STRATEGIES, "oversoldBounce");
  assert.equal(env.TF, "1h");
  assert.equal(env.HTF_TF, "1d");
  assert.equal(env.BACKTEST_LTF_LIMIT, "2200");
  assert.equal(env.BACKTEST_HTF_LIMIT, "400");
  assert.equal(env.BACKTEST_OUTPUT_FILE, "/tmp/out.json");
  assert.match(env.BACKTEST_CONFIG_OVERRIDES, /OVERSOLD_BOUNCE/);
});
