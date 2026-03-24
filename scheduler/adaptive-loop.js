const { execSync } = require("child_process");

function runCycle() {
  console.log("\n=== ADAPTIVE CYCLE START ===");
  execSync("node research/build-consolidated-dataset.js", { stdio: "inherit" });
  execSync("node optimization/auto-adapt-system.js", { stdio: "inherit" });
  console.log("=== ADAPTIVE CYCLE END ===\n");
}

runCycle();
setInterval(runCycle, 10 * 60 * 1000);