const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PID_FILE = path.join(__dirname, ".bot-pids.json");

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startProcess(name, command, args) {
  const child = spawn(command, args, {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  return {
    name,
    pid: child.pid,
    command,
    args,
    startedAt: Date.now(),
  };
}

function main() {
  let existing = [];

  try {
    existing = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    existing = [];
  }

  const stillRunning = existing.filter((p) => isRunning(p.pid));

  if (stillRunning.length > 0) {
    console.log("O bot já parece estar a correr:");
    for (const proc of stillRunning) {
      console.log(`- ${proc.name} (pid ${proc.pid})`);
    }
    return;
  }

  const processes = [];

  processes.push(
    startProcess("signals-loop", "npm", ["run", "loop"])
  );

  processes.push(
    startProcess("adaptive-loop", "node", ["scheduler/adaptive-loop.js"])
  );

  fs.writeFileSync(PID_FILE, JSON.stringify(processes, null, 2), "utf8");

  console.log("Bot arrancado com sucesso:");
  for (const proc of processes) {
    console.log(`- ${proc.name} (pid ${proc.pid})`);
  }
}

main();