import { defaultTargets } from "./config/defaultTargets.js";
import { evaluateAttendance } from "../../shared/attendanceValidation.js";

const cloneTargets = () => structuredClone(defaultTargets);

function getSubmissionId(submission = {}) {
  const playerId = submission.playerId || String(submission.playerName || "unknown").trim().toLowerCase();
  const date = submission.date || String(submission.timestamp || submission.receivedAt || "").slice(0, 10);
  return submission.submissionId || `${playerId}:${date}`;
}

function isPassing(payload, targets) {
  return evaluateAttendance({
    dmResults: payload.dmResults,
    rangeResults: payload.rangeResults,
    targets,
  }).isAttended;
}

export function registerSocketHandlers(io) {
  const targets = cloneTargets();
  const recentSubmissions = [];
  const connectedPlayers = new Map();

  const publishPlayerPresence = () => {
    const players = [...new Set(connectedPlayers.values())].sort((left, right) => left.localeCompare(right));
    io.to("managers").emit("manager:playersOnline", players);
  };

  const initializeManager = (socket) => {
    socket.join("managers");
    if (socket.data.managerInitialized) return;
    socket.data.managerInitialized = true;
    recentSubmissions.forEach((submission) => socket.emit("manager:newSubmission", submission));
    socket.emit("manager:playersOnline", [...new Set(connectedPlayers.values())]);
    io.to("players").emit("manager:requestHistory", { requestId: socket.id });
  };

  io.on("connection", (socket) => {
    socket.emit("targets:current", targets);

    socket.on("auth:identify", (payload = {}) => {
      const username = String(payload.username || "").trim().slice(0, 32);
      const role = payload.role === "manager" ? "manager" : payload.role === "player" ? "player" : "";
      if (!username || !role) return;

      socket.data.profile = { username, role };
      if (role === "player") {
        socket.join("players");
        connectedPlayers.set(socket.id, username);
        publishPlayerPresence();
        socket.emit("manager:requestHistory", {});
      } else {
        initializeManager(socket);
      }
    });

    socket.on("player:join", () => {
      if (socket.data.profile?.role === "player") socket.join("players");
    });
    socket.on("manager:join", () => {
      if (socket.data.profile?.role === "manager") initializeManager(socket);
    });

    socket.on("player:historySnapshot", (payload = {}) => {
      if (socket.data.profile?.role !== "player") return;
      const logs = Array.isArray(payload.logs) ? payload.logs.slice(0, 500) : [];
      const snapshot = { logs };
      if (payload.requestId) io.to(payload.requestId).emit("manager:historySnapshot", snapshot);
      else io.to("managers").emit("manager:historySnapshot", snapshot);
    });

    socket.on("player:submitCompletion", (payload = {}) => {
      if (socket.data.profile?.role !== "player") return;
      const submission = {
        ...payload,
        playerName: socket.data.profile.username,
        submissionId: getSubmissionId(payload),
        passed: isPassing(payload, targets),
        receivedAt: new Date().toISOString(),
      };
      const existingIndex = recentSubmissions.findIndex((item) => getSubmissionId(item) === submission.submissionId);
      if (existingIndex >= 0) recentSubmissions.splice(existingIndex, 1);
      recentSubmissions.unshift(submission);
      recentSubmissions.splice(50);
      io.to("managers").emit("manager:newSubmission", submission);
    });

    socket.on("delete_submission", (payload = {}) => {
      if (socket.data.profile?.role !== "manager") return;
      const submissionId = String(payload.submissionId || "");
      if (!submissionId) return;

      const index = recentSubmissions.findIndex((submission) => getSubmissionId(submission) === submissionId);
      if (index >= 0) recentSubmissions.splice(index, 1);

      const deletion = {
        submissionId,
        playerId: payload.playerId,
        playerName: payload.playerName,
        date: payload.date,
        deletedAt: new Date().toISOString(),
      };
      io.to("managers").emit("manager:submissionDeleted", deletion);
      io.to("players").emit("player:submissionDeleted", deletion);
    });

    socket.on("manager:updateTargets", (nextTargets = {}) => {
      if (socket.data.profile?.role !== "manager") return;
      if (nextTargets.dm) Object.assign(targets.dm, nextTargets.dm);
      if (nextTargets.range) Object.assign(targets.range, nextTargets.range);
      io.to(["managers", "players"]).emit("targets:updated", targets);
    });

    socket.on("disconnect", () => {
      if (connectedPlayers.delete(socket.id)) publishPlayerPresence();
    });
  });

  return targets;
}
