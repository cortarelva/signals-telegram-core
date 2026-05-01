require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { execFileSync } = require("child_process");

const DEFAULT_BASE_URL =
  process.env.BINANCE_PUBLIC_DATA_BASE_URL || "https://data.binance.vision/data/futures/um";
const DEFAULT_OUTPUT_DIR =
  process.env.BINANCE_PUBLIC_HISTORY_DIR ||
  path.join(__dirname, "cache", "binance-public-history");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function monthKey(year, month) {
  return `${year}-${pad2(month)}`;
}

function dayKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function buildMonthlyArchiveUrl(symbol, interval, year, month, baseUrl = DEFAULT_BASE_URL) {
  const normalizedSymbol = safeSlug(symbol);
  return `${String(baseUrl).replace(/\/+$/g, "")}/monthly/klines/${normalizedSymbol}/${interval}/${normalizedSymbol}-${interval}-${year}-${pad2(month)}.zip`;
}

function buildDailyArchiveUrl(symbol, interval, year, month, day, baseUrl = DEFAULT_BASE_URL) {
  const normalizedSymbol = safeSlug(symbol);
  return `${String(baseUrl).replace(/\/+$/g, "")}/daily/klines/${normalizedSymbol}/${interval}/${normalizedSymbol}-${interval}-${year}-${pad2(month)}-${pad2(day)}.zip`;
}

function getHistoryFile(symbol, interval, outputDir = DEFAULT_OUTPUT_DIR) {
  return path.join(outputDir, safeSlug(symbol), `${interval}.json`);
}

function normalizeKlineCsvRow(row) {
  if (!Array.isArray(row) || row.length < 7) return null;

  const normalized = {
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
  };

  if (!Number.isFinite(normalized.openTime) || !Number.isFinite(normalized.closeTime)) {
    return null;
  }

  return normalized;
}

function parseKlineCsvText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeKlineCsvRow(line.split(",")))
    .filter(Boolean);
}

function readHistoryPayload(symbol, interval, outputDir = DEFAULT_OUTPUT_DIR) {
  const file = getHistoryFile(symbol, interval, outputDir);
  if (!fs.existsSync(file)) return null;

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload || !Array.isArray(payload.rows)) return null;
    return payload;
  } catch {
    return null;
  }
}

function writeHistoryPayload(symbol, interval, payload, outputDir = DEFAULT_OUTPUT_DIR) {
  const file = getHistoryFile(symbol, interval, outputDir);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

function mergeSortedUniqueKlines(existingRows = [], incomingRows = []) {
  const byOpenTime = new Map();

  for (const row of existingRows) {
    if (Number.isFinite(Number(row?.openTime))) {
      byOpenTime.set(Number(row.openTime), row);
    }
  }

  for (const row of incomingRows) {
    if (Number.isFinite(Number(row?.openTime))) {
      byOpenTime.set(Number(row.openTime), row);
    }
  }

  return [...byOpenTime.values()].sort((a, b) => Number(a.openTime) - Number(b.openTime));
}

async function downloadArchiveBuffer(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      validateStatus: () => true,
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`archive download failed (${response.status}) for ${url}`);
    }

    return Buffer.from(response.data);
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

function extractFirstFileFromZipBuffer(zipBuffer) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "torus-binance-public-"));
  const zipPath = path.join(tempDir, "archive.zip");

  try {
    fs.writeFileSync(zipPath, zipBuffer);
    const python = [
      "import sys, zipfile",
      "zf = zipfile.ZipFile(sys.argv[1])",
      "names = [name for name in zf.namelist() if not name.endswith('/')]",
      "if not names:",
      "    raise SystemExit('zip archive has no files')",
      "sys.stdout.buffer.write(zf.read(names[0]))",
    ].join("\n");

    return execFileSync("python3", ["-c", python, zipPath], {
      maxBuffer: 128 * 1024 * 1024,
    }).toString("utf8");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function fetchPublicArchiveRows({
  symbol,
  interval,
  year,
  month,
  day = null,
  baseUrl = DEFAULT_BASE_URL,
}) {
  const url = day
    ? buildDailyArchiveUrl(symbol, interval, year, month, day, baseUrl)
    : buildMonthlyArchiveUrl(symbol, interval, year, month, baseUrl);

  const zipBuffer = await downloadArchiveBuffer(url);
  if (!zipBuffer) return { url, rows: [], missing: true };

  const csvText = extractFirstFileFromZipBuffer(zipBuffer);
  return {
    url,
    rows: parseKlineCsvText(csvText),
    missing: false,
  };
}

function buildFullMonthSequence({ months, endDate = new Date() }) {
  const count = Math.max(0, Number(months || 0));
  if (count <= 0) return [];

  const sequence = [];
  const cursor = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));

  for (let offset = 1; offset <= count; offset += 1) {
    const date = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - offset, 1)
    );
    sequence.push({
      kind: "monthly",
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      key: monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1),
    });
  }

  sequence.sort((a, b) => (a.key < b.key ? -1 : 1));
  return sequence;
}

function buildCurrentMonthDailySequence({ endDate = new Date() }) {
  const cursor = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  );
  const yesterday = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  const firstDayOfMonth = new Date(
    Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), 1)
  );

  if (yesterday < firstDayOfMonth) return [];

  const sequence = [];
  for (
    let dayCursor = new Date(firstDayOfMonth);
    dayCursor <= yesterday;
    dayCursor = new Date(dayCursor.getTime() + 24 * 60 * 60 * 1000)
  ) {
    sequence.push({
      kind: "daily",
      year: dayCursor.getUTCFullYear(),
      month: dayCursor.getUTCMonth() + 1,
      day: dayCursor.getUTCDate(),
      key: dayKey(
        dayCursor.getUTCFullYear(),
        dayCursor.getUTCMonth() + 1,
        dayCursor.getUTCDate()
      ),
    });
  }

  return sequence;
}

function buildArchiveSequence({
  months = 12,
  includeCurrentMonthDaily = true,
  endDate = new Date(),
}) {
  const monthly = buildFullMonthSequence({ months, endDate });
  const daily = includeCurrentMonthDaily
    ? buildCurrentMonthDailySequence({ endDate })
    : [];
  return [...monthly, ...daily];
}

function sliceRows(rows = [], { limit = null, endTime = null } = {}) {
  const normalizedEndTime = Number.isFinite(Number(endTime)) ? Number(endTime) : null;
  const filtered = normalizedEndTime
    ? rows.filter((row) => Number(row.closeTime) <= normalizedEndTime)
    : rows;

  if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) {
    return filtered;
  }

  return filtered.slice(-Number(limit));
}

function readBackfilledSlice({ symbol, interval, limit, endTime, outputDir = DEFAULT_OUTPUT_DIR }) {
  const payload = readHistoryPayload(symbol, interval, outputDir);
  if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0) return null;

  return sliceRows(payload.rows, { limit, endTime });
}

async function backfillBinancePublicHistory({
  symbol,
  interval,
  months = 12,
  includeCurrentMonthDaily = true,
  outputDir = DEFAULT_OUTPUT_DIR,
  baseUrl = DEFAULT_BASE_URL,
  force = false,
  endDate = new Date(),
  progress = null,
}) {
  const existingPayload =
    readHistoryPayload(symbol, interval, outputDir) || {
      symbol: safeSlug(symbol),
      interval,
      source: "binance_public_data",
      market: "futures_um",
      archives: {
        monthly: [],
        daily: [],
      },
      rows: [],
    };

  const targetArchives = buildArchiveSequence({
    months,
    includeCurrentMonthDaily,
    endDate,
  });

  const completedMonthly = new Set(existingPayload.archives?.monthly || []);
  const completedDaily = new Set(existingPayload.archives?.daily || []);
  let rows = Array.isArray(existingPayload.rows) ? existingPayload.rows : [];
  let downloadedArchives = 0;
  let skippedArchives = 0;
  let missingArchives = 0;

  for (const archive of targetArchives) {
    const completedSet = archive.kind === "monthly" ? completedMonthly : completedDaily;
    if (!force && completedSet.has(archive.key)) {
      skippedArchives += 1;
      continue;
    }

    if (typeof progress === "function") {
      progress({
        symbol,
        interval,
        archive,
        phase: "download_start",
      });
    }

    const result = await fetchPublicArchiveRows({
      symbol,
      interval,
      year: archive.year,
      month: archive.month,
      day: archive.day || null,
      baseUrl,
    });

    if (result.missing) {
      missingArchives += 1;
      if (typeof progress === "function") {
        progress({
          symbol,
          interval,
          archive,
          phase: "missing",
          url: result.url,
        });
      }
      continue;
    }

    rows = mergeSortedUniqueKlines(rows, result.rows);
    completedSet.add(archive.key);
    downloadedArchives += 1;

    if (typeof progress === "function") {
      progress({
        symbol,
        interval,
        archive,
        phase: "downloaded",
        rows: result.rows.length,
        url: result.url,
      });
    }
  }

  const payload = {
    symbol: safeSlug(symbol),
    interval,
    source: "binance_public_data",
    market: "futures_um",
    updatedAt: new Date().toISOString(),
    window: {
      start: rows[0]?.openTime || null,
      end: rows[rows.length - 1]?.closeTime || null,
      totalRows: rows.length,
    },
    archives: {
      monthly: [...completedMonthly].sort(),
      daily: [...completedDaily].sort(),
    },
    rows,
  };

  const file = writeHistoryPayload(symbol, interval, payload, outputDir);
  return {
    file,
    symbol: safeSlug(symbol),
    interval,
    totalRows: rows.length,
    downloadedArchives,
    skippedArchives,
    missingArchives,
    window: payload.window,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_OUTPUT_DIR,
  buildMonthlyArchiveUrl,
  buildDailyArchiveUrl,
  buildFullMonthSequence,
  buildCurrentMonthDailySequence,
  buildArchiveSequence,
  normalizeKlineCsvRow,
  parseKlineCsvText,
  mergeSortedUniqueKlines,
  readHistoryPayload,
  readBackfilledSlice,
  backfillBinancePublicHistory,
  sliceRows,
  monthKey,
  dayKey,
  getHistoryFile,
};
