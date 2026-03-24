const fs = require("fs");
const path = require("path");

const PID_FILE = path.join(__dirname, ".bot-pids.json");

function stopPid(pid) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (!fs.existsSync(PID_FILE)) {
    console.log("Não existe ficheiro de pids. Nada para parar.");
    return;
  }

  let processes = [];

  try {
    processes = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    console.log("Não foi possível ler o ficheiro de pids.");
    return;
  }

  if (!Array.isArray(processes) || processes.length === 0) {
    console.log("Sem processos registados.");
    return;
  }

  console.log("A parar processos...");

  for (const proc of processes) {
    const ok = stopPid(proc.pid);
    console.log(`- ${proc.name} (pid ${proc.pid}): ${ok ? "ok" : "já parado"}`);
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {}

  console.log("Bot parado.");
}

main();