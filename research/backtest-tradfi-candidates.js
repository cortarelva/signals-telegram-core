require("dotenv").config();

const path = require("path");

const {
  runCandidateStrategyBacktest,
  parseSymbolsOverride,
} = require("./backtest-candidate-strategies");

const DEFAULT_TRADFI_SYMBOLS = [
  "XAUUSDT",
  "XAGUSDT",
  "AAPLUSDT",
  "AMZNUSDT",
  "QQQUSDT",
  "SPYUSDT",
];

async function main() {
  const symbols = parseSymbolsOverride(process.env.TRADFI_SYMBOLS).length
    ? parseSymbolsOverride(process.env.TRADFI_SYMBOLS)
    : DEFAULT_TRADFI_SYMBOLS;

  const outputFile = path.join(__dirname, "tradfi-candidate-strategy-backtest.json");

  console.log(`[TRADFI] symbols: ${symbols.join(", ")}`);

  await runCandidateStrategyBacktest({
    symbols,
    outputFile,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
