const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseRotationBlocks,
  selectRotationBlock,
  resolveRotation,
} = require("../runtime/resolve-hunt-rotation");

test("parseRotationBlocks splits blocks and normalizes symbols", () => {
  const blocks = parseRotationBlocks(" btcusdc, ethusdc | solusdc , xrpusdc | ");
  assert.deepEqual(blocks, [
    ["BTCUSDC", "ETHUSDC"],
    ["SOLUSDC", "XRPUSDC"],
  ]);
});

test("selectRotationBlock wraps indexes safely", () => {
  const blocks = [["A"], ["B"], ["C"]];
  assert.deepEqual(selectRotationBlock(blocks, 4), {
    symbols: ["B"],
    currentIndex: 1,
    nextIndex: 2,
  });
});

test("resolveRotation persists next block across runs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hunt-rotation-"));
  const stateFile = path.join(tempDir, "rotation.json");
  const rotationBlocks = "BTCUSDC,ETHUSDC|SOLUSDC,XRPUSDC|ADAUSDC,LINKUSDC";

  const first = resolveRotation({
    rotationBlocks,
    stateFile,
    profileName: "narrow",
  });
  assert.deepEqual(first.symbols, ["BTCUSDC", "ETHUSDC"]);
  assert.equal(first.currentIndex, 0);
  assert.equal(first.nextIndex, 1);

  const second = resolveRotation({
    rotationBlocks,
    stateFile,
    profileName: "narrow",
  });
  assert.deepEqual(second.symbols, ["SOLUSDC", "XRPUSDC"]);
  assert.equal(second.currentIndex, 1);
  assert.equal(second.nextIndex, 2);

  const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(saved.profileName, "narrow");
  assert.equal(saved.currentIndex, 1);
  assert.equal(saved.nextIndex, 2);
  assert.deepEqual(saved.currentSymbols, ["SOLUSDC", "XRPUSDC"]);
});
