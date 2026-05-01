const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PID_FILE = path.join(__dirname, "bot.pid");
const BOT_LOOP_PATTERN = "runtime/run-bot-loop.sh|runtime/torus-ai-trading.js";

function stopPid(pid) {
  try {
    execFileSync("pkill", ["-TERM", "-P", String(pid)], { stdio: "ignore" });
  } catch {}

  try {
    process.kill(pid, "SIGTERM");
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
      if (Number.isFinite(fromFile)) {
        try {
          process.kill(fromFile, 0);
          pid = fromFile;
        } catch {}
      }
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
    console.log("Não existe ficheiro de pids. Nada para parar.");
    return;
  }

  const ok = stopPid(pid);
  console.log(`- signals-loop (pid ${pid}): ${ok ? "STOPPED" : "já parado"}`);

  try {
    fs.unlinkSync(PID_FILE);
  } catch {}

  console.log("Bot parado.");
}

main();
