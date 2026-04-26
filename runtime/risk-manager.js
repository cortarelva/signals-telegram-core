function getOpenExecutions(state) {
  if (!Array.isArray(state?.executions)) return [];
  return state.executions.filter((e) => e.status === "OPEN");
}

function countOpenBySymbol(openExecutions, symbol) {
  return (openExecutions || []).filter((e) => e.symbol === symbol).length;
}

function countOpenTotal(openExecutions) {
  return (openExecutions || []).length;
}

function toPositiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getDirection(entity) {
  const direction = String(entity?.direction || "").toUpperCase();
  if (direction === "LONG" || direction === "SHORT") return direction;

  const side = String(entity?.side || "").toUpperCase();
  if (side === "BUY") return "LONG";
  if (side === "SELL") return "SHORT";

  return null;
}

function hasValidRiskShape(signalObj) {
  const direction = getDirection(signalObj);
  const entry = Number(signalObj?.entry);
  const sl = Number(signalObj?.sl);
  const tp = Number(signalObj?.tp);

  if (!direction || !Number.isFinite(entry) || entry <= 0) {
    return { ok: false, reason: "invalid_direction_or_entry" };
  }

  if (!Number.isFinite(sl)) {
    return { ok: false, reason: "invalid_stop_price" };
  }

  if (direction === "LONG" && sl >= entry) {
    return { ok: false, reason: "invalid_stop_side" };
  }

  if (direction === "SHORT" && sl <= entry) {
    return { ok: false, reason: "invalid_stop_side" };
  }

  if (Number.isFinite(tp)) {
    if (direction === "LONG" && tp <= entry) {
      return { ok: false, reason: "invalid_target_side" };
    }

    if (direction === "SHORT" && tp >= entry) {
      return { ok: false, reason: "invalid_target_side" };
    }
  }

  return { ok: true };
}

function getExecutionNotionalUsd(execution) {
  return toPositiveNumber(
    execution?.positionNotional ?? execution?.tradeUsd ?? execution?.notionalUsd,
    0
  );
}

function getExecutionRiskUsd(execution) {
  const explicit = toPositiveNumber(execution?.riskUsd, 0);
  if (explicit > 0) return explicit;

  const notional = getExecutionNotionalUsd(execution);
  const stopDistancePct = Number(execution?.stopDistancePct || 0);

  if (notional > 0 && Number.isFinite(stopDistancePct) && stopDistancePct > 0) {
    return notional * stopDistancePct;
  }

  return 0;
}

function deriveProjectedSignalNotionalUsd(signalObj, options = {}) {
  const explicit = toPositiveNumber(signalObj?.positionNotional, 0);
  if (explicit > 0) return explicit;

  const entry = Number(signalObj?.entry);
  const sl = Number(signalObj?.sl);
  const accountSize = toPositiveNumber(
    options.accountSize ?? process.env.ACCOUNT_SIZE,
    0
  );
  const riskPerTrade = toPositiveNumber(
    options.riskPerTrade ??
      process.env.FUTURES_RISK_PER_TRADE ??
      process.env.RISK_PER_TRADE,
    0
  );
  const maxPositionUsd = toPositiveNumber(
    options.maxPositionUsd ??
      process.env.FUTURES_MAX_POSITION_USDT ??
      process.env.FUTURES_MAX_NOTIONAL_USD ??
      process.env.MAX_POSITION_USD,
    0
  );

  if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0) return 0;

  const stopDistancePct = Math.abs(entry - sl) / entry;
  if (!Number.isFinite(stopDistancePct) || stopDistancePct <= 0) return 0;

  const configuredRiskUsd = accountSize * riskPerTrade;
  if (!Number.isFinite(configuredRiskUsd) || configuredRiskUsd <= 0) return 0;

  let projectedNotional = configuredRiskUsd / stopDistancePct;

  if (maxPositionUsd > 0) {
    projectedNotional = Math.min(projectedNotional, maxPositionUsd);
  }

  return projectedNotional;
}

function deriveProjectedSignalRiskUsd(signalObj, options = {}) {
  const explicit = toPositiveNumber(signalObj?.riskUsd, 0);
  if (explicit > 0) return explicit;

  const entry = Number(signalObj?.entry);
  const sl = Number(signalObj?.sl);

  if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0) return 0;

  const stopDistancePct = Math.abs(entry - sl) / entry;
  if (!Number.isFinite(stopDistancePct) || stopDistancePct <= 0) return 0;

  const projectedNotional = deriveProjectedSignalNotionalUsd(signalObj, options);
  return projectedNotional > 0 ? projectedNotional * stopDistancePct : 0;
}

function sumOpenMetric(openExecutions, predicate, valueGetter) {
  return (openExecutions || [])
    .filter(predicate)
    .reduce((sum, execution) => sum + Number(valueGetter(execution) || 0), 0);
}

function buildPortfolioLimits(options = {}) {
  const maxOpenTradesTotal = toPositiveNumber(
    options.maxOpenTradesTotal ?? 0,
    0
  );
  const maxPositionUsd = toPositiveNumber(
    options.maxPositionUsd ??
      process.env.FUTURES_MAX_POSITION_USDT ??
      process.env.FUTURES_MAX_NOTIONAL_USD ??
      process.env.MAX_POSITION_USD,
    0
  );

  const derivedPortfolioNotional =
    maxOpenTradesTotal > 0 && maxPositionUsd > 0
      ? maxOpenTradesTotal * maxPositionUsd
      : 0;

  return {
    maxPortfolioNotionalUsd: toPositiveNumber(
      options.maxPortfolioNotionalUsd ??
        process.env.FUTURES_MAX_PORTFOLIO_NOTIONAL_USDT,
      derivedPortfolioNotional
    ),
    maxSideNotionalUsd: toPositiveNumber(
      options.maxSideNotionalUsd ?? process.env.FUTURES_MAX_SIDE_NOTIONAL_USDT,
      derivedPortfolioNotional > 0 ? derivedPortfolioNotional * 0.65 : 0
    ),
    maxPortfolioRiskUsd: toPositiveNumber(
      options.maxPortfolioRiskUsd ?? process.env.FUTURES_MAX_PORTFOLIO_RISK_USD,
      0
    ),
    maxSideRiskUsd: toPositiveNumber(
      options.maxSideRiskUsd ?? process.env.FUTURES_MAX_SIDE_RISK_USD,
      0
    ),
  };
}

function canExecute(signalObj, state, options = {}) {
  const {
    minScore = 70,
    allowedClasses = ["EXECUTABLE"],
    maxOpenTradesTotal = 10,
    maxOpenTradesPerSymbol = 2,
    allowedSymbols = [],
  } = options;

  if (!signalObj) {
    return { ok: false, reason: "missing_signal" };
  }

  if (!allowedClasses.includes(signalObj.signalClass)) {
    return { ok: false, reason: "class_not_allowed" };
  }

  if ((signalObj.score ?? 0) < minScore) {
    return { ok: false, reason: "score_too_low" };
  }

  if (allowedSymbols.length && !allowedSymbols.includes(signalObj.symbol)) {
    return { ok: false, reason: "symbol_not_allowed" };
  }

  const riskShape = hasValidRiskShape(signalObj);
  if (!riskShape.ok) {
    return riskShape;
  }

  const openExecutions = getOpenExecutions(state);

  if (countOpenTotal(openExecutions) >= maxOpenTradesTotal) {
    return { ok: false, reason: "max_open_total_reached" };
  }

  if (countOpenBySymbol(openExecutions, signalObj.symbol) >= maxOpenTradesPerSymbol) {
    return { ok: false, reason: "max_open_symbol_reached" };
  }

  const duplicate = openExecutions.find(
    (e) =>
      e.symbol === signalObj.symbol &&
      e.tf === signalObj.tf &&
      e.side === signalObj.side
  );

  if (duplicate) {
    return { ok: false, reason: "duplicate_open_trade" };
  }

  const signalDirection = getDirection(signalObj);
  const portfolioLimits = buildPortfolioLimits({
    ...options,
    maxOpenTradesTotal,
  });
  const projectedNotional = deriveProjectedSignalNotionalUsd(signalObj, options);
  const projectedRisk = deriveProjectedSignalRiskUsd(signalObj, options);

  const openPortfolioNotional = sumOpenMetric(
    openExecutions,
    () => true,
    getExecutionNotionalUsd
  );
  const openPortfolioRisk = sumOpenMetric(
    openExecutions,
    () => true,
    getExecutionRiskUsd
  );
  const openSideNotional = sumOpenMetric(
    openExecutions,
    (execution) => getDirection(execution) === signalDirection,
    getExecutionNotionalUsd
  );
  const openSideRisk = sumOpenMetric(
    openExecutions,
    (execution) => getDirection(execution) === signalDirection,
    getExecutionRiskUsd
  );

  if (
    portfolioLimits.maxPortfolioNotionalUsd > 0 &&
    openPortfolioNotional + projectedNotional > portfolioLimits.maxPortfolioNotionalUsd
  ) {
    return { ok: false, reason: "portfolio_notional_limit_reached" };
  }

  if (
    portfolioLimits.maxSideNotionalUsd > 0 &&
    openSideNotional + projectedNotional > portfolioLimits.maxSideNotionalUsd
  ) {
    return { ok: false, reason: "side_notional_limit_reached" };
  }

  if (
    portfolioLimits.maxPortfolioRiskUsd > 0 &&
    openPortfolioRisk + projectedRisk > portfolioLimits.maxPortfolioRiskUsd
  ) {
    return { ok: false, reason: "portfolio_risk_limit_reached" };
  }

  if (
    portfolioLimits.maxSideRiskUsd > 0 &&
    openSideRisk + projectedRisk > portfolioLimits.maxSideRiskUsd
  ) {
    return { ok: false, reason: "side_risk_limit_reached" };
  }

  return { ok: true, reason: "approved" };
}

module.exports = {
  canExecute,
  deriveProjectedSignalNotionalUsd,
  deriveProjectedSignalRiskUsd,
  getExecutionNotionalUsd,
  getExecutionRiskUsd,
};
