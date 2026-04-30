const fs = require("fs");
const path = require("path");

function parseRotationBlocks(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return [];

  return rawValue
    .split("|")
    .map((block) =>
      block
        .split(",")
        .map((symbol) => String(symbol || "").trim().toUpperCase())
        .filter(Boolean)
    )
    .filter((block) => block.length > 0);
}

function normalizeIndex(value, blockCount) {
  if (!blockCount) return 0;
  const numeric = Number.parseInt(String(value || "0"), 10);
  if (!Number.isFinite(numeric)) return 0;
  return ((numeric % blockCount) + blockCount) % blockCount;
}

function selectRotationBlock(blocks, currentIndex) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      symbols: [],
      currentIndex: 0,
      nextIndex: 0,
    };
  }

  const normalizedIndex = normalizeIndex(currentIndex, blocks.length);
  return {
    symbols: blocks[normalizedIndex],
    currentIndex: normalizedIndex,
    nextIndex: (normalizedIndex + 1) % blocks.length,
  };
}

function loadRotationState(stateFile) {
  if (!stateFile) return {};

  try {
    if (!fs.existsSync(stateFile)) return {};
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function saveRotationState(stateFile, payload) {
  if (!stateFile) return;

  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(payload, null, 2), "utf8");
}

function resolveRotation({ rotationBlocks, stateFile, profileName }) {
  const blocks = parseRotationBlocks(rotationBlocks);
  if (!blocks.length) {
    return {
      symbols: [],
      currentIndex: 0,
      nextIndex: 0,
      blockCount: 0,
    };
  }

  const state = loadRotationState(stateFile);
  const selected = selectRotationBlock(blocks, state.nextIndex);

  saveRotationState(stateFile, {
    profileName: profileName || null,
    updatedAt: new Date().toISOString(),
    blockCount: blocks.length,
    currentIndex: selected.currentIndex,
    nextIndex: selected.nextIndex,
    currentSymbols: selected.symbols,
  });

  return {
    symbols: selected.symbols,
    currentIndex: selected.currentIndex,
    nextIndex: selected.nextIndex,
    blockCount: blocks.length,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--rotation-blocks") out.rotationBlocks = next;
    if (arg === "--state-file") out.stateFile = next;
    if (arg === "--profile-name") out.profileName = next;
  }
  return out;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const result = resolveRotation(options);
  process.stdout.write(result.symbols.join(","));
}

module.exports = {
  parseRotationBlocks,
  selectRotationBlock,
  resolveRotation,
};
