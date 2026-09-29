const DEFAULT_TARGETS = {
  dm: { matchesRequired: 2, placementLimit: 5 },
  range: { roundsRequired: 3, minScore: 25 },
};

export function createRequirementsSnapshot(targets = DEFAULT_TARGETS) {
  const dmRequired = toFiniteNumber(targets?.dm?.matchesRequired);
  const placementLimit = toFiniteNumber(targets?.dm?.placementLimit);
  const rangeRequired = toFiniteNumber(targets?.range?.roundsRequired);
  const rangeMinimum = toFiniteNumber(targets?.range?.minScore);
  return {
    dmRequired: Math.max(1, Math.trunc(dmRequired ?? DEFAULT_TARGETS.dm.matchesRequired)),
    topPlacementLimit: Math.max(1, Math.trunc(placementLimit ?? DEFAULT_TARGETS.dm.placementLimit)),
    rangeRequired: Math.max(1, Math.trunc(rangeRequired ?? DEFAULT_TARGETS.range.roundsRequired)),
    rangeMinScore: Math.min(30, Math.max(0, rangeMinimum ?? DEFAULT_TARGETS.range.minScore)),
  };
}

export function getRequirementsSnapshot(submission = {}) {
  if (submission.requirementsSnapshot) {
    const snapshot = submission.requirementsSnapshot;
    return createRequirementsSnapshot({
      dm: {
        matchesRequired: snapshot.dmRequired,
        placementLimit: snapshot.topPlacementLimit,
      },
      range: {
        roundsRequired: snapshot.rangeRequired,
        minScore: snapshot.rangeMinScore,
      },
    });
  }

  const dmResults = submission.dmResults || submission.dm?.placements || [];
  const rangeResults = submission.rangeResults || submission.range?.scores || [];
  return createRequirementsSnapshot({
    dm: {
      matchesRequired: submission.dm?.matchesPlayed || dmResults.length || DEFAULT_TARGETS.dm.matchesRequired,
      placementLimit: DEFAULT_TARGETS.dm.placementLimit,
    },
    range: {
      roundsRequired: submission.range?.roundsPlayed || rangeResults.length || DEFAULT_TARGETS.range.roundsRequired,
      minScore: DEFAULT_TARGETS.range.minScore,
    },
  });
}

function toFiniteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getDeathmatchTier(score, placementLimit) {
  if (score === 1) return { status: "EXCELLENT", badgeColor: "green" };
  if (score >= 2 && score <= 3) return { status: "GOOD", badgeColor: "green" };
  if (score >= 4 && score <= 5) return { status: "PASSED", badgeColor: "cyan" };
  if (score >= 1 && score <= placementLimit) return { status: "PASSED", badgeColor: "cyan" };
  return { status: "MUST RETRY", badgeColor: "red" };
}

function getRangeTier(score, rangeMinimum) {
  if (score >= 29 && score <= 30) return { status: "RADIANT", badgeColor: "gold" };
  if (score >= 27 && score <= 28) return { status: "EXCELLENT", badgeColor: "green" };
  if (score >= 25 && score <= 26) return { status: "GOOD", badgeColor: "cyan" };
  if (score >= rangeMinimum && score <= 30) return { status: "PASSED", badgeColor: "cyan" };
  return { status: "NEED RESUBMIT", badgeColor: "red" };
}

export function formatDrillScore(drill) {
  if (drill.score === null) return "NO SCORE";
  if (drill.type === "range") return `${drill.score}/30`;
  const remainder = drill.score % 100;
  const suffix = remainder >= 11 && remainder <= 13
    ? "th"
    : drill.score % 10 === 1
      ? "st"
      : drill.score % 10 === 2
        ? "nd"
        : drill.score % 10 === 3
          ? "rd"
          : "th";
  return `${drill.score}${suffix} Place`;
}

export function evaluateAttendance(submission = {}) {
  const dmResults = submission.dmResults || submission.dm?.placements || [];
  const rangeResults = submission.rangeResults || submission.range?.scores || [];
  const requirementsSnapshot = getRequirementsSnapshot(submission);
  const dmCount = requirementsSnapshot.dmRequired;
  const rangeCount = requirementsSnapshot.rangeRequired;
  const placementLimit = requirementsSnapshot.topPlacementLimit;
  const rangeMinimum = requirementsSnapshot.rangeMinScore;

  const deathmatches = Array.from({ length: dmCount }, (_, index) => {
    const score = toFiniteNumber(dmResults[index]);
    const tier = getDeathmatchTier(score, placementLimit);
    const needsResubmit = score === null || !Number.isInteger(score) || score < 1 || score > placementLimit;
    return {
      type: "dm",
      index,
      name: `DEATHMATCH ${String(index + 1).padStart(2, "0")}`,
      score,
      status: needsResubmit ? "MUST RETRY" : tier.status,
      badgeColor: needsResubmit ? "red" : tier.badgeColor,
      needsResubmit,
    };
  });

  const rangeDrills = Array.from({ length: rangeCount }, (_, index) => {
    const score = toFiniteNumber(rangeResults[index]);
    const tier = getRangeTier(score, rangeMinimum);
    const needsResubmit = score === null || !Number.isInteger(score) || score < rangeMinimum || score > 30;
    return {
      type: "range",
      index,
      name: `RANGE ROUND ${String(index + 1).padStart(2, "0")}`,
      score,
      status: needsResubmit ? "NEED RESUBMIT" : tier.status,
      badgeColor: needsResubmit ? "red" : tier.badgeColor,
      needsResubmit,
    };
  });

  const drills = [...deathmatches, ...rangeDrills];
  return {
    isAttended: drills.length > 0 && drills.every((drill) => !drill.needsResubmit),
    drills,
    requirementsSnapshot,
    hasRequirementsSnapshot: Boolean(submission.requirementsSnapshot),
  };
}
