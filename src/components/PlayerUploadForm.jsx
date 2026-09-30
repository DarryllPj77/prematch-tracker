import { useEffect, useState } from "react";
import { createRequirementsSnapshot, evaluateAttendance, formatDrillScore, getRequirementsSnapshot } from "../../shared/attendanceValidation.js";
import { extractScoreFromImage } from "../services/mlStub.js";
import { getMySubmissions } from "../services/apiService.js";
import { deleteDailyLog, deleteScreenshot, getSubmissionForPlayerDate, saveDailyLog, saveScreenshot, saveSubmissionData } from "../services/storageService.js";
import * as socketService from "../services/socketService.js";
import SubmissionCalendar from "./SubmissionCalendar.jsx";

const fallbackTargets = { dm: { matchesRequired: 2, placementLimit: 5 }, range: { roundsRequired: 3, minScore: 25 } };

function toLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toPlayerId(playerName) {
  return playerName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "player";
}

function createRetakeState(targets, value = false) {
  return {
    dm: Array(targets.dm.matchesRequired).fill(value),
    range: Array(targets.range.roundsRequired).fill(value),
  };
}

function resizePreserving(values, length, fallback) {
  return Array.from({ length }, (_, index) => values?.[index] ?? fallback);
}

function targetsFromSnapshot(snapshot, baseTargets = fallbackTargets) {
  return {
    dm: {
      ...baseTargets.dm,
      matchesRequired: snapshot.dmRequired,
      placementLimit: snapshot.topPlacementLimit,
    },
    range: {
      ...baseTargets.range,
      roundsRequired: snapshot.rangeRequired,
      minScore: snapshot.rangeMinScore,
    },
  };
}

export default function PlayerUploadForm({ profile }) {
  const [teamIdentity, setTeamIdentity] = useState({ teamCode: profile.teamCode, teamName: profile.teamName });
  const [targets, setTargets] = useState(socketService.getTargets() || fallbackTargets);
  const [player, setPlayer] = useState({ playerName: profile.username, placements: ["", ""], scores: ["", "", ""] });
  const [screenshots, setScreenshots] = useState({ dm: [null, null], range: [null, null, null] });
  const [fileInputKeys, setFileInputKeys] = useState(() => createRetakeState(fallbackTargets, 0));
  const [retaking, setRetaking] = useState(() => createRetakeState(fallbackTargets));
  const [submittedAttendance, setSubmittedAttendance] = useState(null);
  const [message, setMessage] = useState("");
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [hydrating, setHydrating] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateKey(new Date()));
  const todayKey = toLocalDateKey(new Date());
  const isPastDate = selectedDate < todayKey;

  useEffect(() => {
    let active = true;

    async function loadSelectedSubmission() {
      setHydrating(true);
      try {
        const playerName = profile.username;
        let selectedSubmission = await getSubmissionForPlayerDate(playerName, selectedDate);
        try {
          const remoteSubmissions = await getMySubmissions(profile.token, selectedDate);
          if (remoteSubmissions[0]) {
            selectedSubmission = remoteSubmissions[0];
            await saveDailyLog(selectedSubmission);
          }
        } catch {
          // Use the LocalForage cache when the server is temporarily unavailable.
        }
        const activeTargets = socketService.getTargets() || fallbackTargets;
        if (!active) return;

        if (!selectedSubmission) {
          setTargets(activeTargets);
          setPlayer({
            playerName,
            placements: Array(activeTargets.dm.matchesRequired).fill(""),
            scores: Array(activeTargets.range.roundsRequired).fill(""),
          });
          setScreenshots({
            dm: Array(activeTargets.dm.matchesRequired).fill(null),
            range: Array(activeTargets.range.roundsRequired).fill(null),
          });
          setFileInputKeys((current) => ({
            dm: Array.from({ length: activeTargets.dm.matchesRequired }, (_, index) => (current.dm[index] || 0) + 1),
            range: Array.from({ length: activeTargets.range.roundsRequired }, (_, index) => (current.range[index] || 0) + 1),
          }));
          setRetaking(createRetakeState(activeTargets));
          setSubmittedAttendance(null);
          setMessage(selectedDate === toLocalDateKey(new Date())
            ? "A new submission is required for today."
            : "No saved submission exists for the selected date.");
          return;
        }

        const submissionTargets = targetsFromSnapshot(getRequirementsSnapshot(selectedSubmission), activeTargets);
        const placements = resizePreserving(selectedSubmission.dm?.placements, submissionTargets.dm.matchesRequired, "");
        const scores = resizePreserving(selectedSubmission.range?.scores, submissionTargets.range.roundsRequired, "");
        const fallbackKeys = selectedSubmission.screenshotKeys || [];
        const dmScreenshots = resizePreserving(selectedSubmission.screenshotSlots?.dm || fallbackKeys.slice(0, submissionTargets.dm.matchesRequired), submissionTargets.dm.matchesRequired, null);
        const rangeScreenshots = resizePreserving(selectedSubmission.screenshotSlots?.range || fallbackKeys.slice(submissionTargets.dm.matchesRequired), submissionTargets.range.roundsRequired, null);

        setTargets(submissionTargets);
        setPlayer({ playerName, placements, scores });
        setScreenshots({ dm: dmScreenshots, range: rangeScreenshots });
        setFileInputKeys(createRetakeState(submissionTargets, 0));
        setRetaking(createRetakeState(submissionTargets));
        setSubmittedAttendance(evaluateAttendance(selectedSubmission));
        setMessage(selectedDate < toLocalDateKey(new Date())
          ? `Viewing ${selectedDate} in read-only mode.`
          : "Today's submission restored from this device.");
      } catch {
        if (active) setMessage("The selected submission could not be loaded from this device.");
      } finally {
        if (active) setHydrating(false);
      }
    }

    loadSelectedSubmission();
    return () => { active = false; };
  }, [profile.token, profile.username, selectedDate]);

  useEffect(() => {
    let active = true;
    getMySubmissions(profile.token)
      .then(async (submissions) => {
        await Promise.all(submissions.map((submission) => saveDailyLog(submission)));
        if (active) setCalendarRefreshKey((key) => key + 1);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [profile.token]);

  useEffect(() => {
    const update = (next) => {
      if (selectedDate !== toLocalDateKey(new Date())) return;
      setTargets(next);
      setPlayer((current) => ({
        ...current,
        placements: resizePreserving(current.placements, next.dm.matchesRequired, ""),
        scores: resizePreserving(current.scores, next.range.roundsRequired, ""),
      }));
      setScreenshots((current) => ({
        dm: resizePreserving(current.dm, next.dm.matchesRequired, null),
        range: resizePreserving(current.range, next.range.roundsRequired, null),
      }));
      setFileInputKeys((current) => ({
        dm: resizePreserving(current.dm, next.dm.matchesRequired, 0),
        range: resizePreserving(current.range, next.range.roundsRequired, 0),
      }));
      setRetaking((current) => ({
        dm: resizePreserving(current.dm, next.dm.matchesRequired, false),
        range: resizePreserving(current.range, next.range.roundsRequired, false),
      }));
    };
    const removeCurrent = socketService.on("targets:current", update);
    const removeUpdated = socketService.on("targets:updated", update);
    const removeDeleted = socketService.on("player:submissionDeleted", (deletion) => {
      deleteDailyLog(deletion)
        .then(() => setCalendarRefreshKey((key) => key + 1))
        .catch(() => {});
    });
    const removeIdentity = socketService.on("team:identity", (value) => {
      if (value?.teamCode && value?.teamName) setTeamIdentity(value);
    });
    socketService.connect().emit("player:join");
    return () => { removeCurrent(); removeUpdated(); removeDeleted(); removeIdentity(); };
  }, [profile.username, selectedDate]);

  const updateArray = (field, index, value) => {
    setPlayer((current) => ({
      ...current,
      [field]: current[field].map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  };

  const handleScreenshot = async (type, index, file) => {
    if (!file) return;
    const uuid = crypto.randomUUID();
    const previousKey = screenshots[type][index];
    try {
      setMessage("Uploading screenshot proof...");
      const screenshotKey = await saveScreenshot(uuid, file, {
        capturedFor: `${type}-${index + 1}`,
        logKey: `log:${toPlayerId(player.playerName)}:${selectedDate}`,
      });
      await extractScoreFromImage(file, type);
      setScreenshots((current) => ({
        ...current,
        [type]: current[type].map((key, itemIndex) => itemIndex === index ? screenshotKey : key),
      }));
      if (previousKey && previousKey !== screenshotKey) deleteScreenshot(previousKey).catch(() => {});
      setMessage("Screenshot uploaded securely.");
    } catch {
      setMessage("Screenshot upload failed. Check the server storage configuration and try again.");
    }
  };

  const beginRetake = (type, index) => {
    const field = type === "dm" ? "placements" : "scores";
    const previousKey = screenshots[type][index];
    if (previousKey) deleteScreenshot(previousKey).catch(() => {});
    updateArray(field, index, "");
    setScreenshots((current) => ({
      ...current,
      [type]: current[type].map((key, itemIndex) => itemIndex === index ? null : key),
    }));
    setFileInputKeys((current) => ({
      ...current,
      [type]: current[type].map((key, itemIndex) => itemIndex === index ? key + 1 : key),
    }));
    setRetaking((current) => ({
      ...current,
      [type]: current[type].map((active, itemIndex) => itemIndex === index ? true : active),
    }));
    setMessage(`Re-take ${type === "dm" ? "Deathmatch" : "Range"} drill ${index + 1}, then submit again.`);
  };

  const activeRequirementsSnapshot = createRequirementsSnapshot(targets);
  const currentAttendance = evaluateAttendance({
    dmResults: player.placements,
    rangeResults: player.scores,
    requirementsSnapshot: activeRequirementsSnapshot,
  });

  const submit = async (event) => {
    event.preventDefault();
    if (selectedDate !== toLocalDateKey(new Date())) {
      setMessage("Past submissions are read-only. Select today to submit a run.");
      return;
    }
    if (!player.playerName.trim()) {
      setMessage("Enter your player name first.");
      return;
    }

    const requirementsSnapshot = createRequirementsSnapshot(targets);
    const attendance = evaluateAttendance({
      dmResults: player.placements,
      rangeResults: player.scores,
      requirementsSnapshot,
    });
    const dmDrills = attendance.drills.filter((drill) => drill.type === "dm");
    const rangeDrills = attendance.drills.filter((drill) => drill.type === "range");
    const date = selectedDate;
    const playerId = toPlayerId(player.playerName);
    const payload = {
      submissionId: `${playerId}:${date}`,
      playerId,
      playerName: player.playerName.trim(),
      date,
      dmResults: player.placements.map(Number),
      rangeResults: player.scores.map(Number),
      requirementsSnapshot,
      screenshotKeys: [...screenshots.dm, ...screenshots.range].filter(Boolean),
      screenshotSlots: screenshots,
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await socketService.emitWithAck("player:submitCompletion", payload);
      const persistedSubmission = response.submission || {
          submissionId: payload.submissionId,
          playerId: payload.playerId,
          playerName: payload.playerName,
          date,
          dm: { matchesPlayed: payload.dmResults.length, placements: payload.dmResults, passed: dmDrills.every((drill) => !drill.needsResubmit) },
          range: { roundsPlayed: payload.rangeResults.length, scores: payload.rangeResults, passed: rangeDrills.every((drill) => !drill.needsResubmit) },
          isAttended: attendance.isAttended,
          requirementsSnapshot,
          screenshotKeys: payload.screenshotKeys,
          screenshotSlots: screenshots,
          submittedAt: payload.timestamp,
        };
      let cacheSaved = true;
      try {
        await saveSubmissionData({ logEntry: persistedSubmission });
      } catch {
        cacheSaved = false;
      }
      const persistedAttendance = evaluateAttendance(persistedSubmission);
      const persistedTargets = targetsFromSnapshot(persistedAttendance.requirementsSnapshot, targets);
      setTargets(persistedTargets);
      setSubmittedAttendance(persistedAttendance);
      setRetaking(createRetakeState(persistedTargets));
      setCalendarRefreshKey((key) => key + 1);
      const resultMessage = persistedAttendance.isAttended
        ? "Attendance confirmed. Every required drill passed."
        : "No attendance recorded. Re-take only the drills marked in red.";
      setMessage(cacheSaved ? resultMessage : `${resultMessage} Server saved; browser cache unavailable.`);
    } catch {
      setMessage("Submission could not be saved to the server database. Check the connection and try again.");
    }
  };

  const getSubmittedDrill = (type, index) => submittedAttendance?.drills.find((drill) => drill.type === type && drill.index === index);
  const isDrillLocked = (type, index) => {
    if (isPastDate) return true;
    const drill = getSubmittedDrill(type, index);
    if (!drill) return false;
    return !drill.needsResubmit || !retaking[type][index];
  };

  const renderDrillState = (type, index) => {
    const drill = getSubmittedDrill(type, index);
    if (!drill) return null;
    return <div className="player-drill-result">
      <span>{formatDrillScore(drill)}</span>
      <strong className={`drill-tier tier-${drill.badgeColor}`}>{drill.status}</strong>
      {!isPastDate && drill.needsResubmit && !retaking[type][index] && <button type="button" onClick={() => beginRetake(type, index)}>RE-TAKE DRILL</button>}
      {drill.needsResubmit && retaking[type][index] && <em>RE-TAKE ACTIVE</em>}
    </div>;
  };

  return <section className="panel player-panel">
    <header className="player-intake-head">
      <div className="player-intake-copy">
        <div className="eyebrow">PLAYER INTAKE / LIVE TARGETS</div>
        <h1>PREMATCH<br /><span>TRACKER</span></h1>
        <div className="premier-team-heading premier-team-heading--player">
          <span>PREMIER TEAM</span>
          <strong>{teamIdentity.teamName}</strong>
          <small className="team-user-subtitle">
            <span className="user-role-label">PLAYER / </span>
            <span
              className="user-callsign"
              style={{ textTransform: "none", fontFamily: "'Space Mono', monospace", fontVariantCaps: "normal" }}
            >{profile.username}</span>
          </small>
          <small className="team-roster-code">ROSTER CODE / {teamIdentity.teamCode}</small>
        </div>
        <p className="lede">Log your warm-up proof before queue opens.</p>
      </div>
      <SubmissionCalendar
        playerName={player.playerName}
        refreshKey={calendarRefreshKey}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />
    </header>

    <form onSubmit={submit}>
      <label>REGISTERED PLAYER<input value={profile.username} readOnly aria-readonly="true" /></label>
      <div className="entry-grid">
        <fieldset>
          <legend>DEATHMATCH <small>TOP {targets.dm.placementLimit}</small></legend>
          {player.placements.map((value, index) => {
            const submittedDrill = getSubmittedDrill("dm", index);
            const locked = isDrillLocked("dm", index);
            return <div className={`game-entry drill-entry${submittedDrill?.needsResubmit ? " is-failed" : submittedDrill ? " is-passed" : ""}`} key={index}>
              <label>MATCH {String(index + 1).padStart(2, "0")}<input type="number" min="1" value={value} readOnly={locked} onChange={(event) => updateArray("placements", index, event.target.value)} /></label>
              <label>MATCH {String(index + 1).padStart(2, "0")} SCREENSHOT<input key={`dm-file-${index}-${fileInputKeys.dm[index]}`} type="file" accept="image/*" disabled={locked} onChange={(event) => handleScreenshot("dm", index, event.target.files[0])} /></label>
              {renderDrillState("dm", index)}
            </div>;
          })}
        </fieldset>

        <fieldset>
          <legend>THE RANGE <small>{targets.range.difficulty || "MEDIUM BOTS"}</small></legend>
          {player.scores.map((value, index) => {
            const submittedDrill = getSubmittedDrill("range", index);
            const locked = isDrillLocked("range", index);
            return <div className={`game-entry drill-entry${submittedDrill?.needsResubmit ? " is-failed" : submittedDrill ? " is-passed" : ""}`} key={index}>
              <label>ROUND {String(index + 1).padStart(2, "0")}<input type="number" min="0" max="30" value={value} readOnly={locked} onChange={(event) => updateArray("scores", index, event.target.value)} /></label>
              <label>ROUND {String(index + 1).padStart(2, "0")} SCREENSHOT<input key={`range-file-${index}-${fileInputKeys.range[index]}`} type="file" accept="image/*" disabled={locked} onChange={(event) => handleScreenshot("range", index, event.target.files[0])} /></label>
              {renderDrillState("range", index)}
            </div>;
          })}
        </fieldset>
      </div>

      <div className="status-row">
        <span className={isPastDate ? "status" : currentAttendance.isAttended ? "status pass" : "status fail"}>{isPastDate ? "HISTORICAL RECORD" : currentAttendance.isAttended ? "ATTENDANCE READY" : "REQUIREMENTS UNMET"}</span>
        <button className="btn-primary" type="submit" disabled={hydrating || isPastDate}>{hydrating ? "LOADING..." : isPastDate ? "PAST SUBMISSION / READ ONLY" : submittedAttendance && !submittedAttendance.isAttended ? "RESUBMIT FAILED DRILLS" : "SUBMIT RUN"}</button>
      </div>
      {message && <p className="message">{message}</p>}
    </form>
  </section>;
}
