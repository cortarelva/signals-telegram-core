function capStopByAtr({
  entry,
  sl,
  atr,
  direction,
  maxSlToAvgAtr = 1.0,
  round,
  decimals = 6,
}) {
  const safeEntry = Number(entry);
  const safeSl = Number(sl);
  const safeAtr = Number(atr);

  if (
    !Number.isFinite(safeEntry) ||
    !Number.isFinite(safeSl) ||
    !Number.isFinite(safeAtr) ||
    safeAtr <= 0
  ) {
    return {
      sl: safeSl,
      rawSl: safeSl,
      slDistance: Math.abs(safeEntry - safeSl),
      maxStopDistance: null,
      slCapped: false,
      slToAvg: null,
    };
  }

  const rawSl = safeSl;
  const maxStopDistance = safeAtr * Number(maxSlToAvgAtr);
  const rawDistance = Math.abs(safeEntry - rawSl);

  let finalSl = rawSl;
  let slCapped = false;

  if (rawDistance > maxStopDistance) {
    if (direction === "LONG") {
      const cappedSl = safeEntry - maxStopDistance;
      finalSl = Math.max(rawSl, cappedSl);
    } else if (direction === "SHORT") {
      const cappedSl = safeEntry + maxStopDistance;
      finalSl = Math.min(rawSl, cappedSl);
    }
    slCapped = true;
  }

  finalSl = round
    ? round(finalSl, decimals)
    : Number(finalSl.toFixed(decimals));

  return {
    sl: finalSl,
    rawSl,
    slDistance: Math.abs(safeEntry - finalSl),
    maxStopDistance,
    slCapped,
    slToAvg: safeAtr > 0 ? Math.abs(safeEntry - finalSl) / safeAtr : null,
  };
}

module.exports = { capStopByAtr };
