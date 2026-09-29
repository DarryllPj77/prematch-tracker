import { useEffect, useState } from "react";
import { evaluateAttendance, formatDrillScore } from "../../shared/attendanceValidation.js";
import { extractScoreFromImage } from "../services/mlStub.js";
import { deleteDailyLog, getLogsForPlayer, saveScreenshot, saveSubmissionData } from "../services/storageService.js";
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

export default function PlayerUploadForm({ profile }) {
  const [targets, setTargets] = useState(socketService.getTargets() || fallbackTargets);
  const [player, setPlayer] = useState({ playerName: profile.username, placements: ["", ""], scores: ["", "", ""] });
  const [screenshots, setScreenshots] = useState({ dm: [null, null], range: [null, null, null] });
  const [fileInputKeys, setFileInputKeys] = useState(() => createRetakeState(fallbackTargets, 0));
  const [retaking, setRetaking] = useState(() => createRetakeState(fallbackTargets));
  const [submittedAttendance, setSubmittedAttendance] = useState(null);
  const [message, setMessage] = useState("");
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let active = true;

    async function rehydrateSubmission() {
      try {
        const playerName = profile.username;
        const logs = await getLogsForPlayer(playerName);
        const latest = logs[0];
        if (!active || !latest) return;

        const activeTargets = socketService.getTargets() || fallbackTargets;
        const placements = resizePreserving(latest.dm?.placements, activeTargets.dm.matchesRequired, "");
        const scores = resizePreserving(latest.range?.scores, activeTargets.range.roundsRequired, "");
        const fallbackKeys = latest.screenshotKeys || [];
        const dmScreenshots = resizePreserving(latest.screenshotSlots?.dm || fallbackKeys.slice(0, activeTargets.dm.matchesRequired), activeTargets.dm.matchesRequired, null);
        const rangeScreenshots = resizePreserving(latest.screenshotSlots?.range || fallbackKeys.slice(activeTargets.dm.matchesRequired), activeTargets.range.roundsRequired, null);

        setPlayer({ playerName, placements, scores });
        setScreenshots({ dm: dmScreenshots, range: rangeScreenshots });
        setFileInputKeys(createRetakeState(activeTargets, 0));
        setRetaking(createRetakeState(activeTargets));
        setSubmittedAttendance(evaluateAttendance({ dmResults: placements, rangeResults: scores, targets: activeTargets }));
        setMessage("Previous submission restored from this device.");
      } catch {
        if (active) setMessage("Saved submission history could not be restored from this device.");
      } finally {
        if (active) setHydrating(false);
      }
    }

    rehydrateSubmission();
    return () => { active = false; };
  }, [profile.username]);

  useEffect(() => {
    const update = (next) => {
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
    const sendHistorySnapshot = async ({ requestId } = {}) => {
      try {
        const logs = await getLogsForPlayer(profile.username);
        socketService.emit("player:historySnapshot", { requestId, logs });
      } catch {
        socketService.emit("player:historySnapshot", { requestId, logs: [] });
      }
    };
    const removeCurrent = socketService.on("targets:current", update);
    const removeUpdated = socketService.on("targets:updated", update);
    const removeHistoryRequest = socketService.on("manager:requestHistory", sendHistorySnapshot);
    const removeDeleted = socketService.on("player:submissionDeleted", (deletion) => {
      deleteDailyLog(deletion)
        .then(() => setCalendarRefreshKey((key) => key + 1))
        .catch(() => {});
    });
    socketService.connect().emit("player:join");
    sendHistorySnapshot();
    return () => { removeCurrent(); removeUpdated(); removeHistoryRequest(); removeDeleted(); };
  }, [profile.username]);

  const updateArray = (field, index, value) => {
    setPlayer((current) => ({
      ...current,
      [field]: current[field].map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  };

  const handleScreenshot = async (type, index, file) => {
    if (!file) return;
    const uuid = crypto.randomUUID();
    await saveScreenshot(uuid, file, {
      capturedFor: `${type}-${index + 1}`,
      logKey: `log:${toPlayerId(player.playerName)}:${toLocalDateKey()}`,
    });
    await extractScoreFromImage(file, type);
    setScreenshots((current) => ({
      ...current,
      [type]: current[type].map((key, itemIndex) => itemIndex === index ? `shot:${uuid}` : key),
    }));
  };

  const beginRetake = (type, index) => {
    const field = type === "dm" ? "placements" : "scores";
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

  const currentAttendance = evaluateAttendance({
    dmResults: player.placements,
    rangeResults: player.scores,
    targets,
  });

  const submit = async (event) => {
    event.preventDefault();
    if (!player.playerName.trim()) {
      setMessage("Enter your player name first.");
      return;
    }

    const attendance = evaluateAttendance({ dmResults: player.placements, rangeResults: player.scores, targets });
    const dmDrills = attendance.drills.filter((drill) => drill.type === "dm");
    const rangeDrills = attendance.drills.filter((drill) => drill.type === "range");
    const date = toLocalDateKey();
    const playerId = toPlayerId(player.playerName);
    const payload = {
      submissionId: `${playerId}:${date}`,
      playerId,
      playerName: player.playerName.trim(),
      date,
      dmResults: player.placements.map(Number),
      rangeResults: player.scores.map(Number),
      screenshotKeys: [...screenshots.dm, ...screenshots.range].filter(Boolean),
      timestamp: new Date().toISOString(),
    };

    try {
      await saveSubmissionData({ logEntry: {
        submissionId: payload.submissionId,
        playerId: payload.playerId,
        playerName: payload.playerName,
        date,
        dm: { matchesPlayed: payload.dmResults.length, placements: payload.dmResults, passed: dmDrills.every((drill) => !drill.needsResubmit) },
        range: { roundsPlayed: payload.rangeResults.length, scores: payload.rangeResults, passed: rangeDrills.every((drill) => !drill.needsResubmit) },
        isAttended: attendance.isAttended,
        screenshotKeys: payload.screenshotKeys,
        screenshotSlots: screenshots,
        submittedAt: payload.timestamp,
      } });
      socketService.emit("player:submitCompletion", payload);
      setSubmittedAttendance(attendance);
      setRetaking(createRetakeState(targets));
      setCalendarRefreshKey((key) => key + 1);
      setMessage(attendance.isAttended
        ? "Attendance confirmed. Every required drill passed."
        : "No attendance recorded. Re-take only the drills marked in red.");
    } catch {
      setMessage("Submission could not be saved locally. Check browser storage access and try again.");
    }
  };

  const getSubmittedDrill = (type, index) => submittedAttendance?.drills.find((drill) => drill.type === type && drill.index === index);
  const isDrillLocked = (type, index) => {
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
      {drill.needsResubmit && !retaking[type][index] && <button type="button" onClick={() => beginRetake(type, index)}>RE-TAKE DRILL</button>}
      {drill.needsResubmit && retaking[type][index] && <em>RE-TAKE ACTIVE</em>}
    </div>;
  };

  return <section className="panel player-panel">
    <header className="player-intake-head">
      <div className="player-intake-copy"><div className="eyebrow">PLAYER INTAKE / LIVE TARGETS</div><h1>PREMATCH<br /><span>TRACKER</span></h1><p className="lede">Log your warm-up proof before queue opens.</p></div>
      <SubmissionCalendar playerName={player.playerName} refreshKey={calendarRefreshKey} />
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
        <span className={currentAttendance.isAttended ? "status pass" : "status fail"}>{currentAttendance.isAttended ? "ATTENDANCE READY" : "REQUIREMENTS UNMET"}</span>
        <button className="btn-primary" type="submit" disabled={hydrating}>{hydrating ? "RESTORING..." : submittedAttendance && !submittedAttendance.isAttended ? "RESUBMIT FAILED DRILLS" : "SUBMIT RUN"}</button>
      </div>
      {message && <p className="message">{message}</p>}
    </form>
  </section>;
}
