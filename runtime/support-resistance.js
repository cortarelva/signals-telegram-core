function round(n, decimals = 6) {
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(decimals));
}

function isPivotLow(candles, i, left = 2, right = 2) {
  const price = candles[i]?.low;
  if (!Number.isFinite(price)) return false;

  for (let j = i - left; j <= i + right; j++) {
    if (j === i) continue;
    if (!candles[j] || candles[j].low <= price) return false;
  }

  return true;
}

function isPivotHigh(candles, i, left = 2, right = 2) {
  const price = candles[i]?.high;
  if (!Number.isFinite(price)) return false;

  for (let j = i - left; j <= i + right; j++) {
    if (j === i) continue;
    if (!candles[j] || candles[j].high >= price) return false;
  }

  return true;
}

function clusterLevels(levels, toleranceAbs) {
  if (!Array.isArray(levels) || !levels.length) return [];

  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const clusters = [];

  for (const lvl of sorted) {
    const last = clusters[clusters.length - 1];

    if (!last) {
      clusters.push({
        prices: [lvl.price],
        touches: 1,
        firstIndex: lvl.index,
        lastIndex: lvl.index,
      });
      continue;
    }

    const clusterPrice =
      last.prices.reduce((a, b) => a + b, 0) / last.prices.length;

    if (Math.abs(lvl.price - clusterPrice) <= toleranceAbs) {
      last.prices.push(lvl.price);
      last.touches += 1;
      last.lastIndex = lvl.index;
    } else {
      clusters.push({
        prices: [lvl.price],
        touches: 1,
        firstIndex: lvl.index,
        lastIndex: lvl.index,
      });
    }
  }

  return clusters.map((c) => {
    const avgPrice = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
    const span = c.lastIndex - c.firstIndex;

    let strength = "WEAK";
    if (c.touches >= 4 || span >= 50) strength = "STRONG";
    else if (c.touches >= 2 || span >= 20) strength = "MEDIUM";

    return {
      price: round(avgPrice, 6),
      touches: c.touches,
      span,
      strength,
    };
  });
}

function detectSupportResistance(candles, options = {}) {
  const {
    lookback = 120,
    left = 2,
    right = 2,
    atr = null,
    toleranceAtr = 0.35,
    tolerancePct = 0.0025,
  } = options;

  if (!Array.isArray(candles) || candles.length < left + right + 10) {
    return { supports: [], resistances: [] };
  }

  const slice = candles.slice(-lookback);
  const lastClose = slice[slice.length - 1]?.close;
  const toleranceAbs =
    Number.isFinite(atr) && atr > 0
      ? atr * toleranceAtr
      : (lastClose || 0) * tolerancePct;

  const supportPivots = [];
  const resistancePivots = [];

  for (let i = left; i < slice.length - right; i++) {
    if (isPivotLow(slice, i, left, right)) {
      supportPivots.push({ price: slice[i].low, index: i });
    }

    if (isPivotHigh(slice, i, left, right)) {
      resistancePivots.push({ price: slice[i].high, index: i });
    }
  }

  return {
    supports: clusterLevels(supportPivots, toleranceAbs),
    resistances: clusterLevels(resistancePivots, toleranceAbs),
  };
}

function nearestSupportBelow(price, supports) {
  if (!Array.isArray(supports) || !supports.length) return null;

  const filtered = supports
    .filter((s) => Number.isFinite(s.price) && s.price < price)
    .sort((a, b) => b.price - a.price);

  return filtered[0] || null;
}

function nearestResistanceAbove(price, resistances) {
  if (!Array.isArray(resistances) || !resistances.length) return null;

  const filtered = resistances
    .filter((r) => Number.isFinite(r.price) && r.price > price)
    .sort((a, b) => a.price - b.price);

  return filtered[0] || null;
}

function evaluateTradeZone({
  entry,
  atr,
  support,
  resistance,
  minSpaceToTargetAtr = 0.8,
  maxDistanceFromSupportAtr = 1.2,
  maxDistanceFromResistanceAtr = maxDistanceFromSupportAtr,
  direction = "LONG",
}) {
  if (!Number.isFinite(entry) || !Number.isFinite(atr) || atr <= 0) {
    return { passed: false, reason: "invalid_entry_or_atr" };
  }

  const side = String(direction || "LONG").toUpperCase();

  const distanceToSupportAtr = support ? (entry - support.price) / atr : null;
  const distanceToResistanceAtr = resistance
    ? (resistance.price - entry) / atr
    : null;

  if (side === "SHORT" || side === "SELL") {
    if (!resistance) {
      return {
        passed: false,
        reason: "no_resistance",
        distanceToSupportAtr:
          distanceToSupportAtr != null && Number.isFinite(distanceToSupportAtr)
            ? round(distanceToSupportAtr, 4)
            : null,
        distanceToResistanceAtr: null,
      };
    }

    if (distanceToResistanceAtr == null || !Number.isFinite(distanceToResistanceAtr)) {
      return { passed: false, reason: "invalid_resistance_distance" };
    }

    if (distanceToResistanceAtr < 0) {
      return {
        passed: false,
        reason: "entry_above_resistance",
        distanceToSupportAtr:
          distanceToSupportAtr != null && Number.isFinite(distanceToSupportAtr)
            ? round(distanceToSupportAtr, 4)
            : null,
        distanceToResistanceAtr: round(distanceToResistanceAtr, 4),
      };
    }

    if (distanceToResistanceAtr > maxDistanceFromResistanceAtr) {
      return {
        passed: false,
        reason: "too_far_from_resistance",
        distanceToSupportAtr:
          distanceToSupportAtr != null && Number.isFinite(distanceToSupportAtr)
            ? round(distanceToSupportAtr, 4)
            : null,
        distanceToResistanceAtr: round(distanceToResistanceAtr, 4),
      };
    }

    if (
      distanceToSupportAtr != null &&
      Number.isFinite(distanceToSupportAtr) &&
      distanceToSupportAtr < minSpaceToTargetAtr
    ) {
      return {
        passed: false,
        reason: "support_too_close",
        distanceToSupportAtr: round(distanceToSupportAtr, 4),
        distanceToResistanceAtr: round(distanceToResistanceAtr, 4),
      };
    }

    return {
      passed: true,
      reason: "ok",
      distanceToSupportAtr:
        distanceToSupportAtr != null && Number.isFinite(distanceToSupportAtr)
          ? round(distanceToSupportAtr, 4)
          : null,
      distanceToResistanceAtr: round(distanceToResistanceAtr, 4),
    };
  }

  if (!support) {
    return { passed: false, reason: "no_support" };
  }

  if (distanceToSupportAtr < 0) {
    return {
      passed: false,
      reason: "entry_below_support",
      distanceToSupportAtr: round(distanceToSupportAtr, 4),
      distanceToResistanceAtr:
        distanceToResistanceAtr != null
          ? round(distanceToResistanceAtr, 4)
          : null,
    };
  }

  if (distanceToSupportAtr > maxDistanceFromSupportAtr) {
    return {
      passed: false,
      reason: "too_far_from_support",
      distanceToSupportAtr: round(distanceToSupportAtr, 4),
      distanceToResistanceAtr:
        distanceToResistanceAtr != null
          ? round(distanceToResistanceAtr, 4)
          : null,
    };
  }

  if (
    distanceToResistanceAtr != null &&
    distanceToResistanceAtr < minSpaceToTargetAtr
  ) {
    return {
      passed: false,
      reason: "resistance_too_close",
      distanceToSupportAtr: round(distanceToSupportAtr, 4),
      distanceToResistanceAtr: round(distanceToResistanceAtr, 4),
    };
  }

  return {
    passed: true,
    reason: "ok",
    distanceToSupportAtr: round(distanceToSupportAtr, 4),
    distanceToResistanceAtr:
      distanceToResistanceAtr != null
        ? round(distanceToResistanceAtr, 4)
        : null,
  };
}

module.exports = {
  detectSupportResistance,
  nearestSupportBelow,
  nearestResistanceAbove,
  evaluateTradeZone,
};
