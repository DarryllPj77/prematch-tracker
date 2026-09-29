const DEFAULT_TARGETS = {
  dm: { matchesRequired: 2, placementLimit: 5 },
  range: { roundsRequired: 3, minScore: 25 },
};

function toFiniteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getDeathmatchTier(score) {
  if (score === 1) return { status: "EXCELLENT", badgeColor: "green" };
  if (score >= 2 && score <= 3) return { status: "GOOD", badgeColor: "green" };
  if (score >= 4 && score <= 5) return { status: "PASSED", badgeColor: "cyan" };
  return { status: "MUST RETRY", badgeColor: "red" };
}

function getRangeTier(score) {
  if (score >= 29 && score <= 30) return { status: "RADIANT", badgeColor: "gold" };
  if (score >= 27 && score <= 28) return { status: "EXCELLENT", badgeColor: "green" };
  if (score >= 25 && score <= 26) return { status: "GOOD", badgeColor: "cyan" };
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

export function evaluateAttendance({ dmResults = [], rangeResults = [], targets = DEFAULT_TARGETS } = {}) {
  const dmCount = Math.max(0, Math.trunc(Number(targets?.dm?.matchesRequired) || DEFAULT_TARGETS.dm.matchesRequired));
  const rangeCount = Math.max(0, Math.trunc(Number(targets?.range?.roundsRequired) || DEFAULT_TARGETS.range.roundsRequired));
  const placementLimit = Math.min(Number(targets?.dm?.placementLimit) || DEFAULT_TARGETS.dm.placementLimit, 5);
  const rangeMinimum = Math.max(Number(targets?.range?.minScore) || DEFAULT_TARGETS.range.minScore, 25);

  const deathmatches = Array.from({ length: dmCount }, (_, index) => {
    const score = toFiniteNumber(dmResults[index]);
    const tier = getDeathmatchTier(score);
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
    const tier = getRangeTier(score);
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
  };
}
