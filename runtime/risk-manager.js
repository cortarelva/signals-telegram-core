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

function canExecute(signalObj, state, options = {}) {
  const {
    minScore = 70,
    allowedClasses = ["EXECUTABLE"],
    maxOpenTradesTotal = 3,
    maxOpenTradesPerSymbol = 1,
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

  return { ok: true, reason: "approved" };
}

module.exports = {
  canExecute,
};