require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CONFIG_FILE = path.join(__dirname, "tradfi-twelve-equities-config.json");
const RUNNER = path.join(__dirname, "backtest-candidate-strategies.js");
const OUTPUT_DIR = path.join(__dirname, "cache", "tradfi-twelve-equities-backtests");

function loadConfig(filePath = CONFIG_FILE) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function shouldRunProfile(profile, includeObserve = false) {
  if (!profile || typeof profile !== "object") return false;
  if (!Array.isArray(profile.symbols) || !profile.symbols.length) return false;
  if (!Array.isArray(profile.strategies) || !profile.strategies.length) return false;
  if (profile.mode === "observe" && !includeObserve) return false;
  return true;
}

function selectProfiles(config, includeObserve = false) {
  return (config?.profiles || []).filter((profile) =>
    shouldRunProfile(profile, includeObserve)
  );
}

function getProfileOutputPath(profile) {
  return path.join(OUTPUT_DIR, `${profile.label}.json`);
}

function buildProfileEnv(profile, outputFile, baseEnv = process.env) {
  return {
    ...baseEnv,
    EXTERNAL_HISTORY_PROVIDER: "twelvedata",
    EXTERNAL_HISTORY_TRADFI_ONLY: "1",
    BACKTEST_SYMBOLS: profile.symbols.join(","),
    BACKTEST_STRATEGIES: profile.strategies.join(","),
    TF: String(profile.tf),
    HTF_TF: String(profile.htfTf),
    BACKTEST_LTF_LIMIT: String(profile.ltfLimit),
    BACKTEST_HTF_LIMIT: String(profile.htfLimit),
    BACKTEST_CONFIG_OVERRIDES: JSON.stringify(profile.configOverrides || {}),
    BACKTEST_OUTPUT_FILE: outputFile,
  };
}

function sleep(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return;
  spawnSync("sleep", [String(Number(seconds))], { stdio: "inherit" });
}

function runProfile(profile, baseEnv = process.env) {
  const outputFile = getProfileOutputPath(profile);
  const env = buildProfileEnv(profile, outputFile, baseEnv);

  console.log(`\n[PROFILE] ${profile.label}`);
  console.log(
    `symbols=${profile.symbols.join(",")} strategies=${profile.strategies.join(",")} tf=${profile.tf}/${profile.htfTf}`
  );

  const result = spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Profile failed: ${profile.label}`);
  }

  return outputFile;
}

function main() {
  const includeObserve = String(process.env.TRADFI_INCLUDE_OBSERVE || "0") === "1";
  const config = loadConfig();
  const profiles = selectProfiles(config, includeObserve);
  const cooldownSeconds = Number(process.env.TRADFI_PROFILE_COOLDOWN_SECS || config.profileCooldownSeconds || 0);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputs = [];

  profiles.forEach((profile, index) => {
    outputs.push(runProfile(profile));

    if (index < profiles.length - 1 && cooldownSeconds > 0) {
      console.log(`\n[COOLDOWN] waiting ${cooldownSeconds}s before next profile`);
      sleep(cooldownSeconds);
    }
  });

  console.log("\n[COMPLETE]");
  outputs.forEach((filePath) => {
    console.log(filePath);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  CONFIG_FILE,
  OUTPUT_DIR,
  loadConfig,
  shouldRunProfile,
  selectProfiles,
  getProfileOutputPath,
  buildProfileEnv,
};
