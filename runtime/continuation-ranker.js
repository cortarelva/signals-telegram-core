function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeStrategy(strategy) {
  return String(strategy || "").trim().toLowerCase();
}

function isContinuationStrategy(strategy) {
  const normalized = normalizeStrategy(strategy);
  return (
    normalized === "ciphercontinuationlong" ||
    normalized === "ciphercontinuationshort" ||
    normalized === "ignitioncontinuationlong"
  );
}

function computeContinuationRank(candidate) {
  const signal = candidate?.signalObj || {};
  const strategyScore = Number(signal.score || 0);
  const plannedRr = Number(signal.rrPlanned || 0);
  const adx = Number(signal.adx || 0);
  const metaProb = Number(signal.metaModelProbability);
  const minScore = Number(candidate?.selectedMinScore || 0);

  let rank = 0;

  rank += strategyScore;
  rank += clamp((plannedRr - 0.8) * 18, -12, 18);
  rank += clamp((adx - 12) * 0.8, -6, 14);
  rank += clamp((strategyScore - minScore) * 0.6, -4, 12);

  if (signal.nearPullback) rank += 4;

  const direction = String(signal.direction || "").toUpperCase();
  if (direction === "LONG" && signal.bullish) rank += 3;
  if (direction === "SHORT" && signal.bullish === false) rank += 3;

  if (Number.isFinite(metaProb)) {
    rank += clamp((metaProb - 0.55) * 35, -8, 10);
  }

  return Number(rank.toFixed(4));
}

function rankExecutionCandidates(candidates, options = {}) {
  const maxContinuationPerCycle = Math.max(
    1,
    Number(options.maxContinuationPerCycle || 1)
  );
  const enabled = options.enabled !== false;
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];

  if (!enabled || list.length <= 1) {
    return {
      selected: list,
      rejected: [],
      rankedContinuation: [],
    };
  }

  const continuation = [];
  const others = [];

  for (const candidate of list) {
    if (isContinuationStrategy(candidate?.selectedStrategy || candidate?.signalObj?.strategy)) {
      continuation.push(candidate);
    } else {
      others.push(candidate);
    }
  }

  if (continuation.length <= 1) {
    return {
      selected: list,
      rejected: [],
      rankedContinuation: continuation,
    };
  }

  const rankedContinuation = continuation
    .map((candidate) => ({
      candidate,
      rankScore: computeContinuationRank(candidate),
    }))
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;

      const bScore = Number(b.candidate?.signalObj?.score || 0);
      const aScore = Number(a.candidate?.signalObj?.score || 0);
      if (bScore !== aScore) return bScore - aScore;

      const bRr = Number(b.candidate?.signalObj?.rrPlanned || 0);
      const aRr = Number(a.candidate?.signalObj?.rrPlanned || 0);
      return bRr - aRr;
    });

  rankedContinuation.forEach((entry, index) => {
    entry.candidate.continuationRank = index + 1;
    entry.candidate.continuationRankScore = entry.rankScore;
    entry.candidate.continuationRankGroupSize = rankedContinuation.length;
  });

  const selectedContinuation = rankedContinuation
    .slice(0, maxContinuationPerCycle)
    .map((entry) => entry.candidate);
  const rejectedContinuation = rankedContinuation
    .slice(maxContinuationPerCycle)
    .map((entry) => entry.candidate);

  return {
    selected: [...others, ...selectedContinuation],
    rejected: rejectedContinuation,
    rankedContinuation: rankedContinuation.map((entry) => entry.candidate),
  };
}

module.exports = {
  isContinuationStrategy,
  computeContinuationRank,
  rankExecutionCandidates,
};
