require("dotenv").config();

const path = require("path");

const {
  backfillBinancePublicHistory,
  DEFAULT_OUTPUT_DIR,
} = require("./binance-public-history");

const DEFAULT_SYMBOLS = [
  "BTCUSDC",
  "ETHUSDC",
  "ADAUSDC",
  "LINKUSDC",
  "1000SHIBUSDC",
  "1000PEPEUSDC",
];
const DEFAULT_INTERVALS = ["5m", "15m", "1h"];

function parseList(rawValue, fallback = []) {
  if (!rawValue || typeof rawValue !== "string") return [...fallback];
  const values = rawValue
    .split(",")
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
  return values.length ? [...new Set(values)] : [...fallback];
}

function parseIntervals(rawValue, fallback = []) {
  if (!rawValue || typeof rawValue !== "string") return [...fallback];
  const values = rawValue
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return values.length ? [...new Set(values)] : [...fallback];
}

function main() {
  const symbols = parseList(process.env.BINANCE_PUBLIC_BACKFILL_SYMBOLS, DEFAULT_SYMBOLS);
  const intervals = parseIntervals(
    process.env.BINANCE_PUBLIC_BACKFILL_INTERVALS,
    DEFAULT_INTERVALS
  );
  const months = Number(process.env.BINANCE_PUBLIC_BACKFILL_MONTHS || 12);
  const includeCurrentMonthDaily =
    String(process.env.BINANCE_PUBLIC_BACKFILL_INCLUDE_CURRENT_MONTH_DAILY || "1") !== "0";
  const force = String(process.env.BINANCE_PUBLIC_BACKFILL_FORCE || "0") === "1";
  const outputDir = path.resolve(
    process.cwd(),
    process.env.BINANCE_PUBLIC_BACKFILL_OUTPUT_DIR || DEFAULT_OUTPUT_DIR
  );
  const endDate = process.env.BINANCE_PUBLIC_BACKFILL_END_DATE
    ? new Date(process.env.BINANCE_PUBLIC_BACKFILL_END_DATE)
    : new Date();

  if (!Number.isFinite(endDate.getTime())) {
    throw new Error("BINANCE_PUBLIC_BACKFILL_END_DATE inválida");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    outputDir,
    months,
    includeCurrentMonthDaily,
    force,
    jobs: [],
  };

  const runner = async () => {
    for (const symbol of symbols) {
      for (const interval of intervals) {
        console.log(`\n[backfill] ${symbol} ${interval}`);
        const result = await backfillBinancePublicHistory({
          symbol,
          interval,
          months,
          includeCurrentMonthDaily,
          outputDir,
          force,
          endDate,
          progress(event) {
            if (event.phase === "downloaded") {
              console.log(
                `  downloaded ${event.archive.key} (${event.rows} rows)`
              );
            } else if (event.phase === "missing") {
              console.log(`  missing ${event.archive.key}`);
            }
          },
        });

        summary.jobs.push(result);
        console.log(
          `  totalRows=${result.totalRows} downloaded=${result.downloadedArchives} skipped=${result.skippedArchives} missing=${result.missingArchives}`
        );
      }
    }

    console.log(`\nSaved under: ${outputDir}`);
    console.log(JSON.stringify(summary, null, 2));
  };

  runner().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}
