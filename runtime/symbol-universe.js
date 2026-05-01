const KNOWN_TRADFI_BASES = new Set([
  "AAPL",
  "AMZN",
  "COIN",
  "EWJ",
  "EWY",
  "MSTR",
  "NATGAS",
  "PLTR",
  "QQQ",
  "SPY",
  "XAG",
  "XAU",
]);

function parseSymbolSet(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  );
}

function getQuoteAsset(symbol) {
  const upper = String(symbol || "").toUpperCase();
  if (upper.endsWith("USDC")) return "USDC";
  if (upper.endsWith("USDT")) return "USDT";
  if (upper.endsWith("BUSD")) return "BUSD";
  return "";
}

function getBaseAsset(symbol) {
  const upper = String(symbol || "").toUpperCase();
  const quote = getQuoteAsset(upper);
  if (!quote || !upper.endsWith(quote)) return upper;
  return upper.slice(0, -quote.length);
}

function isTradFiSymbol(symbol) {
  const base = getBaseAsset(symbol);
  return KNOWN_TRADFI_BASES.has(base);
}

function isLiveSymbolAllowed(symbol, env = process.env) {
  const upper = String(symbol || "").toUpperCase();
  const allowed = parseSymbolSet(env.LIVE_ALLOWED_SYMBOLS);
  const blocked = parseSymbolSet(env.LIVE_BLOCKED_SYMBOLS);

  if (blocked.has(upper)) return false;
  if (allowed.size > 0) return allowed.has(upper);

  const liveAllowTradFi = String(env.LIVE_ALLOW_TRADFI || "0") === "1";
  if (!liveAllowTradFi && isTradFiSymbol(upper)) return false;

  return true;
}

module.exports = {
  KNOWN_TRADFI_BASES,
  parseSymbolSet,
  getQuoteAsset,
  getBaseAsset,
  isTradFiSymbol,
  isLiveSymbolAllowed,
};
