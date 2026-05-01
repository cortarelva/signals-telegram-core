const NEUTRAL_PNL_THRESHOLD_PCT = 0.02;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveTradeOutcome(trade = {}) {
  const existingReason = String(trade?.closeReason || trade?.outcome || "").toUpperCase();
  const pnlPct = toNumber(trade?.pnlPct);
  const breakEvenApplied = trade?.breakEvenApplied === true;

  if (existingReason.includes("TP")) {
    return {
      outcome: "TP",
      title: "TAKE PROFIT",
      statusEmoji: "✅",
      bucket: "win",
    };
  }

  if (existingReason.includes("SL")) {
    if (breakEvenApplied && pnlPct !== null) {
      if (Math.abs(pnlPct) <= NEUTRAL_PNL_THRESHOLD_PCT) {
        return {
          outcome: "BE",
          title: "BREAK EVEN",
          statusEmoji: "🟨",
          bucket: "neutral",
        };
      }

      if (pnlPct > NEUTRAL_PNL_THRESHOLD_PCT) {
        return {
          outcome: "PROTECTED_SL",
          title: "PROTECTED STOP",
          statusEmoji: "🛡️",
          bucket: "win",
        };
      }
    }

    return {
      outcome: "SL",
      title: "STOP LOSS",
      statusEmoji: "❌",
      bucket: "loss",
    };
  }

  if (pnlPct !== null) {
    if (pnlPct > NEUTRAL_PNL_THRESHOLD_PCT) {
      return {
        outcome: "WIN",
        title: "WIN",
        statusEmoji: "✅",
        bucket: "win",
      };
    }

    if (pnlPct < -NEUTRAL_PNL_THRESHOLD_PCT) {
      return {
        outcome: "LOSS",
        title: "LOSS",
        statusEmoji: "❌",
        bucket: "loss",
      };
    }

    return {
      outcome: "FLAT",
      title: "FLAT EXIT",
      statusEmoji: "🟨",
      bucket: "neutral",
    };
  }

  return {
    outcome: String(trade?.outcome || trade?.closeReason || "UNKNOWN").toUpperCase(),
    title: "EXIT",
    statusEmoji: "ℹ️",
    bucket: "neutral",
  };
}

module.exports = {
  NEUTRAL_PNL_THRESHOLD_PCT,
  resolveTradeOutcome,
};
