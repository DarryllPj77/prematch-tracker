import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayerAttendanceTimeline } from "./attendanceTimeline.js";

test("fills past gaps for one player, sorts newest first, and excludes today", () => {
  const submissions = [
    {
      id: "momo:2026-09-29",
      playerName: "Momo",
      date: "2026-09-29",
      submittedAt: "2026-09-29T12:00:00",
      dmResults: [3, 4],
      rangeResults: [25, 26, 27],
      screenshotKeys: [],
      passed: true,
    },
    { id: "other", playerName: "Other", date: "2026-09-30" },
  ];
  const player = {
    id: 2,
    name: "Momo",
    createdAt: new Date(2026, 8, 28, 8).toISOString(),
  };

  const timeline = buildPlayerAttendanceTimeline(submissions, player, new Date(2026, 9, 1, 12));

  assert.deepEqual(timeline.map((record) => record.date), ["2026-09-30", "2026-09-29", "2026-09-28"]);
  assert.equal(timeline[0].isMissed, true);
  assert.equal(timeline[1].isMissed, undefined);
  assert.equal(timeline.some((record) => record.date === "2026-10-01"), false);
  assert.equal(timeline.some((record) => record.playerName === "Other"), false);
});

test("uses the earliest submission when legacy roster data has no registration date", () => {
  const submissions = [{ id: "legacy", playerName: "Momo", date: "2026-09-29" }];
  const timeline = buildPlayerAttendanceTimeline(submissions, { name: "Momo" }, new Date(2026, 9, 1, 12));

  assert.deepEqual(timeline.map((record) => record.date), ["2026-09-30", "2026-09-29"]);
  assert.equal(timeline[0].isMissed, true);
});
