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

  const publishPlayerPresence = () => {
    const players = [...new Set(connectedPlayers.values())].sort((left, right) => left.localeCompare(right));
    io.to("managers").emit("manager:playersOnline", players);
  };

  const initializeManager = async (socket) => {
    socket.join("managers");
    if (socket.data.managerInitialized) return;
    socket.data.managerInitialized = true;
    const [submissions, targets] = await Promise.all([
      repository.getSubmissions(),
      repository.getTargets(),
    ]);
    socket.emit("manager:historySnapshot", { logs: submissions });
    socket.emit("targets:current", targets);
    socket.emit("manager:playersOnline", [...new Set(connectedPlayers.values())]);
  };

  io.on("connection", async (socket) => {
    const profile = socket.data.profile;
    try {
      socket.emit("targets:current", await repository.getTargets());
    } catch (error) {
      console.error("Could not load target settings:", error);
    }

    if (profile.role === "player") {
      socket.join("players");
      connectedPlayers.set(socket.id, profile.username);
      publishPlayerPresence();
    } else if (profile.role === "manager") {
      initializeManager(socket).catch((error) => console.error("Could not initialize manager:", error));
    }

    socket.on("player:join", () => {
      if (profile.role !== "player") return;
      socket.join("players");
      connectedPlayers.set(socket.id, profile.username);
      publishPlayerPresence();
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
        const requirementsSnapshot = createRequirementsSnapshot(await repository.getTargets());
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

        io.to("managers").emit("manager:newSubmission", submission);
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
        const removed = await repository.deleteSubmission(submissionId);
        if (!removed) {
          acknowledge({ ok: false, error: "Submission was not found." });
          return;
        }
        const deletion = { ...removed, deletedAt: new Date().toISOString() };
        io.to("managers").emit("manager:submissionDeleted", deletion);
        io.to("players").emit("player:submissionDeleted", deletion);
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
        const currentTargets = await repository.getTargets();
        const normalized = normalizeTargets(nextTargets, currentTargets);
        const saved = await repository.saveTargets(normalized, profile.id);
        io.to(["managers", "players"]).emit("targets:updated", saved);
        acknowledge({ ok: true, targets: saved });
      } catch (error) {
        acknowledgeError(acknowledge, error);
      }
    });

    socket.on("disconnect", () => {
      if (connectedPlayers.delete(socket.id)) publishPlayerPresence();
    });
  });
}
