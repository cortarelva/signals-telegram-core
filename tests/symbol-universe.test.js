const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getBaseAsset,
  getQuoteAsset,
  isTradFiSymbol,
  isLiveSymbolAllowed,
} = require("../runtime/symbol-universe");

test("symbol-universe extracts quote and base assets", () => {
  assert.equal(getQuoteAsset("ETHUSDC"), "USDC");
  assert.equal(getQuoteAsset("XAUUSDT"), "USDT");
  assert.equal(getBaseAsset("ETHUSDC"), "ETH");
  assert.equal(getBaseAsset("XAUUSDT"), "XAU");
});

test("symbol-universe recognizes current tradfi symbols", () => {
  assert.equal(isTradFiSymbol("XAUUSDT"), true);
  assert.equal(isTradFiSymbol("AMZNUSDT"), true);
  assert.equal(isTradFiSymbol("ETHUSDC"), false);
});

test("live universe blocks tradfi by default and respects overrides", () => {
  assert.equal(isLiveSymbolAllowed("XAUUSDT", {}), false);
  assert.equal(isLiveSymbolAllowed("ETHUSDC", {}), true);
  assert.equal(isLiveSymbolAllowed("XAUUSDT", { LIVE_ALLOW_TRADFI: "1" }), true);
  assert.equal(
    isLiveSymbolAllowed("ETHUSDC", { LIVE_ALLOWED_SYMBOLS: "BTCUSDC, ADAUSDC" }),
    false
  );
  assert.equal(
    isLiveSymbolAllowed("ADAUSDC", { LIVE_ALLOWED_SYMBOLS: "BTCUSDC, ADAUSDC" }),
    true
  );
  assert.equal(
    isLiveSymbolAllowed("ADAUSDC", { LIVE_BLOCKED_SYMBOLS: "ADAUSDC,ETHUSDC" }),
    false
  );
});
