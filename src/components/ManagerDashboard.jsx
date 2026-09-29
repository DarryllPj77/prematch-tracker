import { useEffect, useMemo, useState } from "react";
import { evaluateAttendance, formatDrillScore } from "../../shared/attendanceValidation.js";
import * as socketService from "../services/socketService.js";
import { deleteDailyLog } from "../services/storageService.js";
import ManagerAttendanceCalendar from "./ManagerAttendanceCalendar.jsx";
import ScreenshotModal from "./ScreenshotModal.jsx";
import ScreenshotPreview from "./ScreenshotPreview.jsx";
import TargetSettingsPanel from "./TargetSettingsPanel.jsx";

const fallbackTargets = { dm: { matchesRequired: 2, placementLimit: 5 }, range: { roundsRequired: 3, minScore: 25 } };

function toLocalDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeSubmission(submission) {
  const timestamp = submission.submittedAt || submission.timestamp || submission.receivedAt || new Date().toISOString();
  const dmResults = submission.dmResults || submission.dm?.placements || [];
  const rangeResults = submission.rangeResults || submission.range?.scores || [];
  const storedPassed = typeof submission.passed === "boolean"
    ? submission.passed
    : typeof submission.isAttended === "boolean"
      ? submission.isAttended
      : Boolean(submission.dm?.passed && submission.range?.passed);
  const playerName = submission.playerName?.trim() || "UNKNOWN PLAYER";
  const playerId = submission.playerId || playerName.toLowerCase();
  const date = submission.date || toLocalDateKey(timestamp);
  const normalized = {
    ...submission,
    dmResults,
    rangeResults,
  };
  const attendance = evaluateAttendance(normalized);

  return {
    ...normalized,
    id: submission.submissionId || `${String(playerId).toLowerCase()}:${date}`,
    playerId,
    playerName,
    date,
    dmResults,
    rangeResults,
    screenshotKeys: submission.screenshotKeys || [],
    submittedAt: timestamp,
    receivedAt: submission.receivedAt || timestamp,
    passed: attendance.hasRequirementsSnapshot ? attendance.isAttended : storedPassed,
  };
}

function mergeSubmissions(items) {
  const merged = new Map();
  items.map(normalizeSubmission).forEach((submission) => {
    const existing = merged.get(submission.id);
    if (!existing) {
      merged.set(submission.id, submission);
      return;
    }

    const incomingIsNewer = submission.submittedAt > existing.submittedAt;
    const sameTimestamp = submission.submittedAt === existing.submittedAt;
    const incomingIsPersisted = Boolean(submission.dm && submission.range);
    const existingIsPersisted = Boolean(existing.dm && existing.range);
    const preferIncoming = incomingIsNewer || (sameTimestamp && incomingIsPersisted && !existingIsPersisted);
    const primary = preferIncoming ? submission : existing;
    const secondary = preferIncoming ? existing : submission;

    merged.set(submission.id, {
      ...secondary,
      ...primary,
      dmResults: primary.dmResults.length ? primary.dmResults : secondary.dmResults || [],
      rangeResults: primary.rangeResults.length ? primary.rangeResults : secondary.rangeResults || [],
      screenshotKeys: primary.screenshotKeys.length ? primary.screenshotKeys : secondary.screenshotKeys || [],
      requirementsSnapshot: primary.requirementsSnapshot || secondary.requirementsSnapshot,
    });
  });
  return [...merged.values()].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}

function formatSubmissionTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "TIME UNAVAILABLE";
  return date.toLocaleString([], { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ManagerDashboard() {
  const [targets, setTargets] = useState(socketService.getTargets() || fallbackTargets);
  const [submissions, setSubmissions] = useState([]);
  const [registeredPlayers, setRegisteredPlayers] = useState([]);
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [previewModal, setPreviewModal] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    const current = (value) => setTargets(value);
    const incoming = (value) => setSubmissions((items) => mergeSubmissions([...items, value]));
    const historySnapshot = (value) => {
      if (Array.isArray(value?.logs)) {
        setSubmissions(mergeSubmissions(value.logs));
        setHistoryError(false);
      }
    };
    const rosterSnapshot = (value) => {
      const players = Array.isArray(value?.players) ? value.players : [];
      setRegisteredPlayers(players
        .map((player) => ({
          id: player?.id,
          name: String(player?.name || player?.username || "").trim(),
        }))
        .filter((player) => player.name));
    };
    const connectionError = () => setHistoryError(true);
    const presence = (players) => setOnlinePlayers(Array.isArray(players) ? players : []);
    const deleted = (value) => {
      setSubmissions((items) => items.filter((item) => item.id !== value.submissionId));
      setSelectedSubmissionId((id) => id === value.submissionId ? "" : id);
      setPendingDeleteId((id) => id === value.submissionId ? "" : id);
      setPreviewModal((preview) => preview?.submissionId === value.submissionId ? null : preview);
      deleteDailyLog(value).catch(() => {});
    };
    const removeCurrent = socketService.on("targets:current", current);
    const removeUpdated = socketService.on("targets:updated", current);
    const removeIncoming = socketService.on("manager:newSubmission", incoming);
    const removeHistorySnapshot = socketService.on("manager:historySnapshot", historySnapshot);
    const removeRosterSnapshot = socketService.on("manager:rosterSnapshot", rosterSnapshot);
    const removePresence = socketService.on("manager:playersOnline", presence);
    const removeDeleted = socketService.on("manager:submissionDeleted", deleted);
    const removeConnectionError = socketService.on("connect_error", connectionError);
    socketService.connect().emit("manager:join");
    return () => { removeCurrent(); removeUpdated(); removeIncoming(); removeHistorySnapshot(); removeRosterSnapshot(); removePresence(); removeDeleted(); removeConnectionError(); };
  }, []);

  const roster = useMemo(() => {
    const players = new Map();
    registeredPlayers.forEach((player) => {
      players.set(player.name.toLowerCase(), { ...player, passed: null, online: false });
    });
    submissions.forEach((submission) => {
      const key = submission.playerName.toLowerCase();
      const existing = players.get(key);
      if (!existing || existing.passed === null) {
        players.set(key, { ...existing, name: submission.playerName, passed: submission.passed, online: false });
      }
    });
    onlinePlayers.forEach((name) => {
      const key = name.toLowerCase();
      const existing = players.get(key);
      players.set(key, existing ? { ...existing, online: true } : { name, passed: null, online: true });
    });
    return [...players.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [registeredPlayers, submissions, onlinePlayers]);

  const filteredLogs = useMemo(() => submissions.filter((submission) => {
    const matchesPlayer = !selectedPlayer || submission.playerName.toLowerCase() === selectedPlayer.toLowerCase();
    const matchesDate = !selectedDate || submission.date === selectedDate;
    return matchesPlayer && matchesDate;
  }), [submissions, selectedPlayer, selectedDate]);

  const selectedSubmission = submissions.find((submission) => submission.id === selectedSubmissionId);
  const selectedAttendance = selectedSubmission
    ? evaluateAttendance(selectedSubmission)
    : null;

  const selectPlayer = (playerName) => {
    setSelectedPlayer(playerName);
    setSelectedDate("");
    const latest = submissions.find((submission) => submission.playerName.toLowerCase() === playerName.toLowerCase());
    setSelectedSubmissionId(latest?.id || "");
  };

  const selectDate = (date) => {
    setSelectedDate(date);
    setSelectedSubmissionId("");
  };

  const openPreview = (submission, screenshotKey) => {
    setPreviewModal({
      submissionId: submission.id,
      screenshotKey,
      playerName: submission.playerName,
      submittedAt: submission.submittedAt,
      passed: submission.passed,
      dmResults: submission.dmResults,
      rangeResults: submission.rangeResults,
    });
  };

  const saveTargets = async (nextTargets) => {
    try {
      const response = await socketService.emitWithAck("manager:updateTargets", nextTargets);
      setTargets(response.targets);
      setSettingsOpen(false);
    } catch {
      setHistoryError(true);
    }
  };

  const confirmDelete = async (submission) => {
    setDeletingId(submission.id);
    setDeleteError("");
    try {
      await socketService.emitWithAck("delete_submission", {
        submissionId: submission.id,
        playerId: submission.playerId,
        playerName: submission.playerName,
        date: submission.date,
      });
      await deleteDailyLog(submission);
      setSubmissions((items) => items.filter((item) => item.id !== submission.id));
      setSelectedSubmissionId((id) => id === submission.id ? "" : id);
      setPreviewModal((preview) => preview?.submissionId === submission.id ? null : preview);
      setPendingDeleteId("");
    } catch {
      setDeleteError(`Could not delete ${submission.playerName}'s submission from local storage.`);
    } finally {
      setDeletingId("");
    }
  };

  return <section className="dashboard">
    <header className="dashboard-head">
      <div><div className="eyebrow">COMMAND CENTER / LIVE RELAY</div><h1>MANAGER <span>FEED</span></h1></div>
      <button className="btn-ghost" type="button" onClick={() => setSettingsOpen(true)}>TARGET SETTINGS</button>
    </header>

    <div className="dashboard-grid">
      <aside className="dashboard-sidebar">
        <section className="roster" aria-label="Player roster">
          <div className="roster-title"><span className="eyebrow">ROSTER / {roster.length || "--"}</span><small>FILTER FEED</small></div>
          <button className={`roster-filter${selectedPlayer ? "" : " is-selected"}`} type="button" onClick={() => { setSelectedPlayer(""); setSelectedSubmissionId(""); }}>ALL PLAYERS <span>{roster.length}</span></button>
          {roster.length === 0
            ? <div className="roster-empty">No players registered yet.</div>
            : roster.map((player) => <button className={`roster-player${selectedPlayer.toLowerCase() === player.name.toLowerCase() ? " is-selected" : ""}`} type="button" key={player.name} onClick={() => selectPlayer(player.name)}>
              <i className={`dot${player.online ? " online" : ""}`} />
              <strong>{player.name}</strong>
              <small>{player.online
                ? `ONLINE${player.passed === null ? " / NO SUBMISSIONS" : player.passed ? " / LATEST RUN PASSED" : " / LATEST RUN FAILED"}`
                : `OFFLINE${player.passed === null ? " / NO SUBMISSIONS" : player.passed ? " / LATEST RUN PASSED" : " / LATEST RUN FAILED"}`}</small>
            </button>)}
        </section>

        <ManagerAttendanceCalendar logs={submissions} selectedPlayer={selectedPlayer} selectedDate={selectedDate} onSelectDate={selectDate} />
      </aside>

      <main className="feed">
        <div className="section-title">
          <span className="feed-title-copy">{selectedPlayer || "ALL PLAYERS"}{selectedDate ? ` / ${selectedDate}` : " / RECENT COMPLETIONS"}</span>
          <span>{filteredLogs.length} RECORD{filteredLogs.length === 1 ? "" : "S"}</span>
        </div>

        {(selectedPlayer || selectedDate) && <div className="active-filters">
          {selectedPlayer && <button type="button" onClick={() => { setSelectedPlayer(""); setSelectedSubmissionId(""); }}>PLAYER: {selectedPlayer} ×</button>}
          {selectedDate && <button type="button" onClick={() => setSelectedDate("")}>DATE: {selectedDate} ×</button>}
        </div>}

        {historyError && <div className="dashboard-notice">DATABASE HISTORY UNAVAILABLE — CHECK THE SERVER CONNECTION</div>}
        {deleteError && <div className="dashboard-notice">{deleteError}</div>}

        {selectedSubmission && <section className="submission-detail cut-corner" aria-label={`${selectedSubmission.playerName} submission details`}>
          <div className="submission-detail-head">
            <div><span>SUBMISSION INSPECTOR</span><h2>{selectedSubmission.playerName}</h2></div>
            <button type="button" onClick={() => setSelectedSubmissionId("")}>CLOSE</button>
          </div>
          <div className={`attendance-result ${selectedAttendance.isAttended ? "is-attended" : "is-unmet"}`}>
            <span>DAILY RESULT</span>
            <strong>{selectedAttendance.isAttended ? "ATTENDANCE CONFIRMED / PASSED" : "NO ATTENDANCE (REQUIREMENTS UNMET)"}</strong>
          </div>
          <div className="submission-detail-meta">
            <span>EXACT TIMESTAMP</span>
            <strong>{formatSubmissionTime(selectedSubmission.submittedAt)}</strong>
          </div>
          <p className="submission-requirements-note">
            Evaluated against: Top {selectedAttendance.requirementsSnapshot.topPlacementLimit} placement, {selectedAttendance.requirementsSnapshot.dmRequired} DM matches, {selectedAttendance.requirementsSnapshot.rangeRequired} Range rounds, minimum Range score {selectedAttendance.requirementsSnapshot.rangeMinScore}.
            {!selectedAttendance.hasRequirementsSnapshot && " Legacy record: an original settings snapshot was unavailable, so frozen legacy rules inferred from the saved record are shown."}
          </p>
          <div className="submission-drill-list">
            {selectedAttendance.drills.map((drill) => <article className={`submission-drill-card tier-${drill.badgeColor}${drill.needsResubmit ? " needs-resubmit" : ""}`} key={`${drill.type}-${drill.index}`}>
              <span className="drill-name">{drill.name}</span>
              <strong className="drill-score">{formatDrillScore(drill)}</strong>
              <span className={`drill-tier tier-${drill.badgeColor}`}>{drill.status}</span>
            </article>)}
          </div>
          <div className="submission-detail-proofs">
            {selectedSubmission.screenshotKeys.length
              ? selectedSubmission.screenshotKeys.map((key) => <ScreenshotPreview screenshotKey={key} key={key} onOpen={() => openPreview(selectedSubmission, key)} />)
              : <div className="shot shot-empty">NO SCREENSHOTS</div>}
          </div>
        </section>}

        {filteredLogs.length === 0 && <div className="empty-state">No submissions match the active player and date filters.</div>}
        {filteredLogs.map((submission, index) => <article
          className={`submission${selectedSubmissionId === submission.id ? " is-selected" : ""}`}
          key={submission.id}
          role="button"
          tabIndex="0"
          onClick={() => setSelectedSubmissionId(submission.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedSubmissionId(submission.id);
            }
          }}
          style={{ animationDelay: `${index * 35}ms` }}
        >
          <div><strong>{submission.playerName}</strong><small>{formatSubmissionTime(submission.submittedAt)}</small></div>
          <div className="result-lines">DM {submission.dmResults.join(" / ") || "--"}<br />RANGE {submission.rangeResults.join(" / ") || "--"}</div>
          <span className={`status ${submission.passed ? "pass" : "fail"}`}>{submission.passed ? "PASS" : "FAIL"}</span>
          {submission.screenshotKeys[0]
            ? <ScreenshotPreview screenshotKey={submission.screenshotKeys[0]} onOpen={() => openPreview(submission, submission.screenshotKeys[0])} />
            : <div className="shot shot-empty">NO PROOF</div>}
          <div className="submission-actions">
            <button type="button" className="submission-open" onClick={(event) => { event.stopPropagation(); setSelectedSubmissionId(submission.id); }}>VIEW DETAILS</button>
            <button type="button" className="submission-delete" onClick={(event) => { event.stopPropagation(); setPendingDeleteId(submission.id); setDeleteError(""); }}>DELETE</button>
          </div>
          {pendingDeleteId === submission.id && <div className="delete-confirmation" onClick={(event) => event.stopPropagation()}>
            <span>DELETE THIS SUBMISSION FOR <strong>{submission.playerName}</strong>?</span>
            <div>
              <button type="button" className="delete-cancel" onClick={() => setPendingDeleteId("")} disabled={deletingId === submission.id}>CANCEL</button>
              <button type="button" className="delete-confirm" onClick={() => confirmDelete(submission)} disabled={deletingId === submission.id}>{deletingId === submission.id ? "DELETING..." : "CONFIRM DELETE"}</button>
            </div>
          </div>}
        </article>)}
      </main>
    </div>

    {settingsOpen && <TargetSettingsPanel targets={targets} onSave={saveTargets} onClose={() => setSettingsOpen(false)} />}
    {previewModal && <ScreenshotModal preview={previewModal} onClose={() => setPreviewModal(null)} />}
  </section>;
}
