const fs = require("fs");
const path = require("path");

const PID_FILE = path.join(__dirname, ".bot-pids.json");

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (!fs.existsSync(PID_FILE)) {
    console.log("Bot não está registado como ativo.");
    return;
  }

  let processes = [];

  try {
    processes = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    console.log("Erro ao ler ficheiro de pids.");
    return;
  }

  for (const proc of processes) {
    console.log(
      `- ${proc.name} (pid ${proc.pid}): ${isRunning(proc.pid) ? "RUNNING" : "STOPPED"}`
    );
  }
}

main();