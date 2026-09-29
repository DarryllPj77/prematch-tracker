import { createRequirementsSnapshot, evaluateAttendance } from "../../shared/attendanceValidation.js";

function toPlayerId(playerName) {
  return String(playerName || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "player";
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function acknowledgeError(acknowledge, error) {
  console.error(error);
  acknowledge({ ok: false, error: "The server could not persist this change." });
}

function normalizeTargets(nextTargets, currentTargets) {
  const snapshot = createRequirementsSnapshot({
    dm: { ...currentTargets.dm, ...nextTargets?.dm },
    range: { ...currentTargets.range, ...nextTargets?.range },
  });
  return {
    dm: {
      ...currentTargets.dm,
      matchesRequired: snapshot.dmRequired,
      placementLimit: snapshot.topPlacementLimit,
    },
    range: {
      ...currentTargets.range,
      roundsRequired: snapshot.rangeRequired,
      minScore: snapshot.rangeMinScore,
    },
  };
}

export function registerSocketHandlers(io, repository) {
  const connectedPlayers = new Map();
  const teamRoom = (teamCode) => `team:${teamCode}`;
  const managerRoom = (teamCode) => `${teamRoom(teamCode)}:managers`;
  const playerRoom = (teamCode) => `${teamRoom(teamCode)}:players`;

  const getOnlinePlayers = (teamCode) => [...new Set(
    [...connectedPlayers.values()]
      .filter((player) => player.teamCode === teamCode)
      .map((player) => player.name),
  )]
    .sort((left, right) => left.localeCompare(right));

  const publishPlayerPresence = (teamCode) => {
    io.to(managerRoom(teamCode)).emit("manager:playersOnline", getOnlinePlayers(teamCode));
  };

  const publishRosterSnapshot = async (teamCode) => {
    const players = await repository.getPlayers(teamCode);
    io.to(managerRoom(teamCode)).emit("manager:rosterSnapshot", { players });
  };

  const initializeManager = async (socket) => {
    const { teamCode } = socket.data.profile;
    socket.join(teamRoom(teamCode));
    socket.join(managerRoom(teamCode));
    const [submissions, targets, players] = await Promise.all([
      repository.getSubmissions({ teamCode }),
      repository.getTargets(teamCode),
      repository.getPlayers(teamCode),
    ]);
    socket.emit("manager:historySnapshot", { logs: submissions });
    socket.emit("manager:rosterSnapshot", { players });
    socket.emit("targets:current", targets);
    socket.emit("manager:playersOnline", getOnlinePlayers(teamCode));
  };

  io.on("connection", async (socket) => {
    const profile = socket.data.profile;
    try {
      socket.emit("targets:current", await repository.getTargets(profile.teamCode));
    } catch (error) {
      console.error("Could not load target settings:", error);
    }

    if (profile.role === "player") {
      socket.join(teamRoom(profile.teamCode));
      socket.join(playerRoom(profile.teamCode));
      connectedPlayers.set(socket.id, { name: profile.username, teamCode: profile.teamCode });
      publishPlayerPresence(profile.teamCode);
      publishRosterSnapshot(profile.teamCode).catch((error) => console.error("Could not publish player roster:", error));
    } else if (profile.role === "manager") {
      initializeManager(socket).catch((error) => console.error("Could not initialize manager:", error));
    }

    socket.on("player:join", () => {
      if (profile.role !== "player") return;
      socket.join(teamRoom(profile.teamCode));
      socket.join(playerRoom(profile.teamCode));
      connectedPlayers.set(socket.id, { name: profile.username, teamCode: profile.teamCode });
      publishPlayerPresence(profile.teamCode);
      publishRosterSnapshot(profile.teamCode).catch((error) => console.error("Could not publish player roster:", error));
    });

    socket.on("manager:join", () => {
      if (profile.role === "manager") {
        initializeManager(socket).catch((error) => console.error("Could not initialize manager:", error));
      }
    });

    socket.on("player:submitCompletion", async (payload = {}, acknowledge = () => {}) => {
      if (profile.role !== "player") {
        acknowledge({ ok: false, error: "Player access is required." });
        return;
      }
      if (!validDate(payload.date) || !payload.requirementsSnapshot) {
        acknowledge({ ok: false, error: "Submission date and requirements snapshot are required." });
        return;
      }

      try {
        const playerId = toPlayerId(profile.username);
        const requirementsSnapshot = createRequirementsSnapshot(await repository.getTargets(profile.teamCode));
        const draft = {
          dmResults: Array.isArray(payload.dmResults) ? payload.dmResults : [],
          rangeResults: Array.isArray(payload.rangeResults) ? payload.rangeResults : [],
          requirementsSnapshot,
        };
        const attendance = evaluateAttendance(draft);
        const dmDrills = attendance.drills.filter((drill) => drill.type === "dm");
        const rangeDrills = attendance.drills.filter((drill) => drill.type === "range");
        const submission = await repository.upsertSubmission({
          submissionId: `${playerId}:${payload.date}`,
          playerId,
          playerName: profile.username,
          date: payload.date,
          dmResults: draft.dmResults,
          rangeResults: draft.rangeResults,
          requirementsSnapshot,
          screenshotKeys: Array.isArray(payload.screenshotKeys) ? payload.screenshotKeys : [],
          screenshotSlots: payload.screenshotSlots || { dm: [], range: [] },
          isAttended: attendance.isAttended,
          dmPassed: dmDrills.every((drill) => !drill.needsResubmit),
          rangePassed: rangeDrills.every((drill) => !drill.needsResubmit),
          submittedAt: payload.timestamp || new Date().toISOString(),
        }, profile.id);

        io.to(managerRoom(profile.teamCode)).emit("manager:newSubmission", submission);
        acknowledge({ ok: true, submission });
      } catch (error) {
        acknowledgeError(acknowledge, error);
      }
    });

    socket.on("delete_submission", async (payload = {}, acknowledge = () => {}) => {
      if (profile.role !== "manager") {
        acknowledge({ ok: false, error: "Manager access is required." });
        return;
      }
      const submissionId = String(payload.submissionId || "");
      if (!submissionId) {
        acknowledge({ ok: false, error: "Submission ID is required." });
        return;
      }

      try {
        const removed = await repository.deleteSubmission(submissionId, profile.teamCode);
        if (!removed) {
          acknowledge({ ok: false, error: "Submission was not found." });
          return;
        }
        const deletion = { ...removed, deletedAt: new Date().toISOString() };
        io.to(managerRoom(profile.teamCode)).emit("manager:submissionDeleted", deletion);
        io.to(playerRoom(profile.teamCode)).emit("player:submissionDeleted", deletion);
        acknowledge({ ok: true, deletion });
      } catch (error) {
        acknowledgeError(acknowledge, error);
      }
    });

    socket.on("manager:updateTargets", async (nextTargets = {}, acknowledge = () => {}) => {
      if (profile.role !== "manager") {
        acknowledge({ ok: false, error: "Manager access is required." });
        return;
      }
      try {
        const currentTargets = await repository.getTargets(profile.teamCode);
        const normalized = normalizeTargets(nextTargets, currentTargets);
        const saved = await repository.saveTargets(profile.teamCode, normalized, profile.id);
        io.to(teamRoom(profile.teamCode)).emit("targets:updated", saved);
        acknowledge({ ok: true, targets: saved });
      } catch (error) {
        acknowledgeError(acknowledge, error);
      }
    });

    socket.on("disconnect", () => {
      const player = connectedPlayers.get(socket.id);
      if (connectedPlayers.delete(socket.id) && player) publishPlayerPresence(player.teamCode);
    });
  });
}
