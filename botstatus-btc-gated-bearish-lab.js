const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PID_FILE = path.join(__dirname, "bot-btc-gated-bearish-lab.pid");
const BOT_LOOP_PATTERN = "run-btc-gated-bearish-lab-loop.sh";

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function main() {
  let pid = null;

  try {
    if (fs.existsSync(PID_FILE)) {
      const fromFile = Number(fs.readFileSync(PID_FILE, "utf8"));
      if (Number.isFinite(fromFile) && isRunning(fromFile)) pid = fromFile;
    }
  } catch {}

  if (!pid) {
    try {
      const output = execFileSync("pgrep", ["-fo", BOT_LOOP_PATTERN], {
        cwd: __dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const fromPgrep = Number(String(output || "").trim().split("\n")[0]);
      if (Number.isFinite(fromPgrep)) pid = fromPgrep;
    } catch {}
  }

  if (!pid) {
    console.log("BTC-gated bearish lab não está registado como ativo.");
    return;
  }

  console.log(
    `- btc-gated-bearish-lab (pid ${pid}): ${
      isRunning(pid) ? "RUNNING" : "STOPPED"
    }`
  );
}

main();
