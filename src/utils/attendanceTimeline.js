export function toLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function belongsToPlayer(submission, playerName) {
  return String(submission.playerName || "").trim().toLowerCase() === playerName.toLowerCase();
}

export function getPlayerAttendanceStartDate(player, submissions = []) {
  const registeredDate = player?.createdAt ? toLocalDateKey(player.createdAt) : "";
  if (registeredDate) return registeredDate;

  return submissions
    .filter((submission) => belongsToPlayer(submission, String(player?.name || "")))
    .map((submission) => submission.date)
    .filter(Boolean)
    .sort()[0] || "";
}

export function buildPlayerAttendanceTimeline(submissions, player, today = new Date()) {
  const playerName = String(player?.name || "").trim();
  if (!playerName) return [];

  const playerSubmissions = submissions.filter((submission) => belongsToPlayer(submission, playerName));
  const startDate = getPlayerAttendanceStartDate(player, playerSubmissions);
  const todayKey = toLocalDateKey(today);
  const records = [...playerSubmissions];

  if (startDate && todayKey && startDate < todayKey) {
    const submittedDates = new Set(playerSubmissions.map((submission) => submission.date));
    for (let date = dateFromKey(startDate); toLocalDateKey(date) < todayKey; date.setDate(date.getDate() + 1)) {
      const dateKey = toLocalDateKey(date);
      if (submittedDates.has(dateKey)) continue;
      records.push({
        id: `missed:${String(player.id || playerName).toLowerCase()}:${dateKey}`,
        playerId: player.id || playerName.toLowerCase(),
        playerName,
        date: dateKey,
        dmResults: [],
        rangeResults: [],
        screenshotKeys: [],
        passed: false,
        isMissed: true,
      });
    }
  }

  return records.sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date);
    if (dateOrder) return dateOrder;
    return String(right.submittedAt || "").localeCompare(String(left.submittedAt || ""));
  });
}
