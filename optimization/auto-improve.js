const { execSync } = require("child_process");
const fs = require("fs");

function run(cmd) {
  console.log(`\n[RUN] ${cmd}`);
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    console.error(`\n[ERROR] Command failed: ${cmd}`);
    console.error(err.stdout || "");
    console.error(err.stderr || "");
    throw err;
  }
}

function parseBacktestMetrics(text) {
  const tradesMatch = text.match(/Trades:\s*(\d+)/i);
  const tpMatch = text.match(/TP:\s*(\d+)/i);
  const slMatch = text.match(/SL:\s*(\d+)/i);
  const winrateMatch = text.match(/Winrate:\s*([\d.]+)%/i);

  return {
    trades: tradesMatch ? parseInt(tradesMatch[1], 10) : 0,
    tp: tpMatch ? parseInt(tpMatch[1], 10) : 0,
    sl: slMatch ? parseInt(slMatch[1], 10) : 0,
    winrate: winrateMatch ? parseFloat(winrateMatch[1]) : 0,
  };
}

function extractTopCandidate(text) {
  const lines = text.split("\n");
  const topLine = lines.find((line) => line.startsWith("#1 |"));
  if (!topLine) return null;

  const rsiMatch = topLine.match(/RSI=\[(\d+),\s*(\d+)\]/i);
  const slMatch = topLine.match(/SLx=([\d.]+)/i);
  const tpMatch = topLine.match(/TPx=([\d.]+)/i);

  const statsLineIndex = lines.findIndex((line) => line === topLine);
  const statsLine = statsLineIndex >= 0 ? lines[statsLineIndex + 2] || "" : "";

  const winrateMatch = statsLine.match(/winRate=([\d.]+)%/i);
  const expectancyMatch = statsLine.match(/expectancy=([-\d.]+)/i);

  if (!rsiMatch || !slMatch || !tpMatch) return null;

  return {
    RSI_MIN: Number(rsiMatch[1]),
    RSI_MAX: Number(rsiMatch[2]),
    SL_ATR_MULT: Number(slMatch[1]),
    TP_ATR_MULT: Number(tpMatch[1]),
    winrate: winrateMatch ? Number(winrateMatch[1]) : null,
    expectancy: expectancyMatch ? Number(expectancyMatch[1]) : null,
  };
}

function readEnvFile(envPath = ".env") {
  if (!fs.existsSync(envPath)) return "";
  return fs.readFileSync(envPath, "utf8");
}

function updateEnvValue(envText, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(envText)) {
    return envText.replace(re, `${key}=${value}`);
  }
  return envText.trimEnd() + `\n${key}=${value}\n`;
}

function backupFile(path) {
  if (!fs.existsSync(path)) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(path, `${path}.bak.${ts}`);
}

function main() {
  console.log("=== AUTO IMPROVE START ===");

  const baselineOutput = run("node backtest-bot.js");
  console.log("\n=== BASELINE BACKTEST ===\n");
  console.log(baselineOutput);

  const baseline = parseBacktestMetrics(baselineOutput);

  if (baseline.trades < 30) {
    console.log(
      `Baseline has too few trades (${baseline.trades}). Not applying improvements.`
    );
    return;
  }

  const optimizeOutput = run("node optimize-strategy.js");
  console.log("\n=== OPTIMIZER OUTPUT ===\n");
  console.log(optimizeOutput);

  const candidate = extractTopCandidate(optimizeOutput);

  if (!candidate) {
    console.log("Could not extract top candidate from optimizer output.");
    return;
  }

  console.log("\n=== TOP CANDIDATE ===");
  console.log(candidate);

  if (
    candidate.winrate == null ||
    candidate.expectancy == null
  ) {
    console.log("Candidate metrics incomplete. No changes applied.");
    return;
  }

  const shouldApply =
    baseline.trades >= 50 &&
    candidate.winrate >= baseline.winrate;

  if (!shouldApply) {
    console.log("Candidate did not beat baseline guardrails. No changes applied.");
    return;
  }

  let envText = readEnvFile(".env");
  backupFile(".env");

  envText = updateEnvValue(envText, "RSI_MIN", candidate.RSI_MIN);
  envText = updateEnvValue(envText, "RSI_MAX", candidate.RSI_MAX);
  envText = updateEnvValue(envText, "SL_ATR_MULT", candidate.SL_ATR_MULT);
  envText = updateEnvValue(envText, "TP_ATR_MULT", candidate.TP_ATR_MULT);

  fs.writeFileSync(".env", envText, "utf8");

  const logEntry = {
    ts: new Date().toISOString(),
    baseline,
    applied: candidate,
  };

  fs.writeFileSync(
    "improvement-log.jsonl",
    JSON.stringify(logEntry) + "\n",
    { flag: "a" }
  );

  console.log("\nImprovement candidate applied to .env");
  console.log("A backup of .env was created.");
}

main();