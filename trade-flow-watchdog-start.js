const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PID_FILE = path.join(ROOT, "runtime", "trade-flow-watchdog.pid");
const LOG_FILE = path.join(ROOT, "logs", "trade-flow-watchdog.log");

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function main() {
  try {
    const existingPid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    if (Number.isFinite(existingPid) && isRunning(existingPid)) {
      console.log(`trade-flow-watchdog já está a correr (pid ${existingPid})`);
      return;
    }
  } catch {
    // no-op
  }

  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const logFd = fs.openSync(LOG_FILE, "a");

  const child = spawn("node", ["scripts/trade-flow-watchdog.js"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.writeFileSync(PID_FILE, `${child.pid}\n`, "utf8");

  console.log(`trade-flow-watchdog arrancado (pid ${child.pid})`);
}

main();
