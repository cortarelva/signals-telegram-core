function normalizeGateStates(value, fallback = ["risk_off_selloff"]) {
  if (Array.isArray(value)) {
    const states = [...new Set(
      value
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )];
    return states.length ? states : fallback;
  }

  if (typeof value === "string") {
    const states = [...new Set(
      value
        .split(",")
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )];
    return states.length ? states : fallback;
  }

  return fallback;
}

function passesBtcContextGate(snapshot, options = {}) {
  const gateStates = normalizeGateStates(
    options.states || options.gateStates,
    ["risk_off_selloff"]
  );
  const requiredDirection = String(
    options.btcDirection || options.requiredDirection || "down"
  )
    .trim()
    .toLowerCase();
  const minNegativeBreadth = Number.isFinite(Number(options.minNegativeBreadth))
    ? Number(options.minNegativeBreadth)
    : 0.6;
  const minFollowRate = Number.isFinite(Number(options.minFollowRate))
    ? Number(options.minFollowRate)
    : 0.6;

  if (!snapshot || !gateStates.includes(snapshot.state)) {
    return {
      allowed: false,
      reason: `btc_gate:state_${snapshot?.state || "missing"}`,
    };
  }

  const actualDirection = String(snapshot?.btc?.direction || "unknown").toLowerCase();
  if (actualDirection !== requiredDirection) {
    return {
      allowed: false,
      reason: `btc_gate:btc_direction_${actualDirection}`,
    };
  }

  if (Number(snapshot?.alts?.negativeBreadth || 0) < minNegativeBreadth) {
    return {
      allowed: false,
      reason: "btc_gate:negative_breadth_too_low",
    };
  }

  if (Number(snapshot?.alts?.followRate || 0) < minFollowRate) {
    return {
      allowed: false,
      reason: "btc_gate:follow_rate_too_low",
    };
  }

  return {
    allowed: true,
    reason: "btc_gate:passed",
  };
}

module.exports = {
  normalizeGateStates,
  passesBtcContextGate,
};
