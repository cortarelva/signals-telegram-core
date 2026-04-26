const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const PID_FILE = path.join(__dirname, "bot.pid");
const BOT_LOOP_PATTERN = "runtime/run-bot-loop.sh|runtime/torus-ai-trading.js";

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findExistingBotPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = Number(fs.readFileSync(PID_FILE, "utf8"));
      if (Number.isFinite(pid) && isRunning(pid)) return pid;
    }
  } catch {}

  try {
    const output = execFileSync("pgrep", ["-fo", BOT_LOOP_PATTERN], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pid = Number(String(output || "").trim().split("\n")[0]);
    if (Number.isFinite(pid) && isRunning(pid)) return pid;
  } catch {}

  return null;
}

function startProcess(command, args) {
  const child = spawn(command, args, {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  return child.pid;
}

function main() {
  const existingPid = findExistingBotPid();
  if (existingPid) {
    console.log(`- signals-loop (pid ${existingPid}): RUNNING`);
    return;
  }

  const pid = startProcess("bash", [path.join(__dirname, "runtime", "run-bot-loop.sh")]);
  fs.writeFileSync(PID_FILE, String(pid), "utf8");

  console.log(`- signals-loop (pid ${pid}): RUNNING`);
}

main();
