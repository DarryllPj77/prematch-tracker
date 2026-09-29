import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import { Server } from "socket.io";
import { io as createClient } from "socket.io-client";
import { createAuthService } from "../src/auth.js";
import { registerSocketHandlers } from "../src/socketHandlers.js";

const defaultTargets = {
  dm: { matchesRequired: 2, placementLimit: 5 },
  range: { roundsRequired: 3, minScore: 25 },
};

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe("database-backed authentication", () => {
  test("registers hashed users, verifies PINs, and protects manager registration", async () => {
    const users = new Map();
    let nextId = 1;
    const repository = {
      async findUserByUsername(username) {
        return users.get(username.trim().toLowerCase()) || null;
      },
      async findManagerByTeamCode(teamCode) {
        return [...users.values()].find((user) => user.role === "manager" && user.team_code === teamCode) || null;
      },
      async assignPlayerToTeam(userId, teamCode) {
        const user = [...users.values()].find((item) => item.id === userId && item.role === "player" && !item.team_code);
        if (!user) return null;
        user.team_code = teamCode;
        return user;
      },
      async createUser({ username, pinHash, role, teamCode }) {
        const user = { id: nextId++, username, pin_hash: pinHash, role, team_code: teamCode };
        users.set(username.toLowerCase(), user);
        return user;
      },
    };
    const auth = createAuthService({
      repository,
      jwtSecret: "test-secret-that-is-longer-than-thirty-two-characters",
      managerSignupCode: "manager-only",
    });

    const manager = await auth.register({ username: "Coach", pin: "4321", role: "manager", managerCode: "manager-only" });
    assert.match(manager.teamCode, /^[A-Z0-9]{4}$/);

    const player = await auth.register({ username: "Momo", pin: "1234", role: "player", teamCode: manager.teamCode });
    assert.equal(player.role, "player");
    assert.equal(player.teamCode, manager.teamCode);
    assert.notEqual(users.get("momo").pin_hash, "1234");
    assert.equal((await auth.login({ username: "momo", pin: "1234" })).teamCode, manager.teamCode);
    assert.equal(auth.verifyToken(player.token).teamCode, manager.teamCode);

    await assert.rejects(
      auth.register({ username: "Stranger", pin: "1111", role: "player", teamCode: "NOPE" }),
      (error) => error.code === "INVALID_TEAM_CODE",
    );

    await assert.rejects(
      auth.register({ username: "Boss", pin: "4321", role: "manager", managerCode: "wrong" }),
      (error) => error.code === "INVALID_MANAGER_CODE",
    );
  });
});

describe("persistent Socket.io workflow", () => {
  let httpServer;
  let ioServer;
  let manager;
  let otherManager;
  let refreshedManager;
  let player;
  let otherPlayer;
  let baseUrl;
  const submissions = new Map();
  const targetsByTeam = new Map();
  const playerTeams = new Map([[2, "K9X2"], [4, "R4V4"]]);
  const registeredPlayers = [
    { id: 2, name: "Momo", teamCode: "K9X2", createdAt: "2026-09-29T00:00:00.000Z" },
    { id: 4, name: "Rival", teamCode: "R4V4", createdAt: "2026-09-29T00:00:00.000Z" },
  ];

  const repository = {
    async getPlayers(teamCode) {
      return registeredPlayers.filter((playerRecord) => playerRecord.teamCode === teamCode);
    },
    async getTargets(teamCode) {
      return structuredClone(targetsByTeam.get(teamCode) || defaultTargets);
    },
    async saveTargets(teamCode, nextTargets) {
      targetsByTeam.set(teamCode, structuredClone(nextTargets));
      return structuredClone(nextTargets);
    },
    async getSubmissions({ userId, teamCode } = {}) {
      return [...submissions.values()].filter((item) => (!userId || item.userId === userId) && (!teamCode || item.teamCode === teamCode));
    },
    async upsertSubmission(submission, userId) {
      const stored = {
        ...submission,
        userId,
        teamCode: playerTeams.get(userId),
        passed: submission.isAttended,
        dm: { placements: submission.dmResults, passed: submission.dmPassed },
        range: { scores: submission.rangeResults, passed: submission.rangePassed },
        submittedAt: submission.submittedAt,
      };
      submissions.set(submission.submissionId, stored);
      return stored;
    },
    async deleteSubmission(submissionId, teamCode) {
      const existing = submissions.get(submissionId);
      if (!existing || existing.teamCode !== teamCode) return null;
      submissions.delete(submissionId);
      return existing;
    },
  };

  before(async () => {
    httpServer = createServer();
    ioServer = new Server(httpServer);
    ioServer.use((socket, next) => {
      socket.data.profile = socket.handshake.auth.profile;
      next();
    });
    registerSocketHandlers(ioServer, repository);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    manager?.disconnect();
    otherManager?.disconnect();
    refreshedManager?.disconnect();
    player?.disconnect();
    otherPlayer?.disconnect();
    await ioServer.close();
  });

  test("persists settings and submissions and returns database history", async () => {
    manager = createClient(baseUrl, { autoConnect: false, auth: { profile: { id: 1, username: "Coach", role: "manager", teamCode: "K9X2" } } });
    const historyPromise = once(manager, "manager:historySnapshot");
    const rosterPromise = once(manager, "manager:rosterSnapshot");
    manager.connect();
    await once(manager, "connect");
    assert.deepEqual((await historyPromise).logs, []);
    assert.deepEqual((await rosterPromise).players.map((item) => item.name), ["Momo"]);

    otherManager = createClient(baseUrl, { autoConnect: false, auth: { profile: { id: 3, username: "Other Coach", role: "manager", teamCode: "R4V4" } } });
    const otherRosterPromise = once(otherManager, "manager:rosterSnapshot");
    otherManager.connect();
    await once(otherManager, "connect");
    assert.deepEqual((await otherRosterPromise).players.map((item) => item.name), ["Rival"]);

    player = createClient(baseUrl, { autoConnect: false, auth: { profile: { id: 2, username: "Momo", role: "player", teamCode: "K9X2" } } });
    const onlinePromise = once(manager, "manager:playersOnline");
    player.connect();
    await once(player, "connect");
    assert.deepEqual(await onlinePromise, ["Momo"]);

    otherPlayer = createClient(baseUrl, { autoConnect: false, auth: { profile: { id: 4, username: "Rival", role: "player", teamCode: "R4V4" } } });
    const otherOnlinePromise = once(otherManager, "manager:playersOnline");
    otherPlayer.connect();
    await once(otherPlayer, "connect");
    assert.deepEqual(await otherOnlinePromise, ["Rival"]);

    const settingsResponse = await emitWithAck(manager, "manager:updateTargets", {
      dm: { matchesRequired: 5, placementLimit: 3 },
      range: { roundsRequired: 3, minScore: 25 },
    });
    assert.equal(settingsResponse.ok, true);
    assert.equal((await repository.getTargets("K9X2")).dm.matchesRequired, 5);
    assert.equal((await repository.getTargets("R4V4")).dm.matchesRequired, 2);

    const incomingPromise = once(manager, "manager:newSubmission");
    const submissionResponse = await emitWithAck(player, "player:submitCompletion", {
      date: "2026-09-29",
      dmResults: [3, 2, 1, 3, 2],
      rangeResults: [25, 26, 27],
      requirementsSnapshot: { dmRequired: 2, topPlacementLimit: 5, rangeRequired: 3, rangeMinScore: 25 },
      screenshotKeys: [],
      screenshotSlots: { dm: [], range: [] },
      timestamp: "2026-09-29T01:00:00.000Z",
    });
    assert.equal(submissionResponse.ok, true);
    assert.equal(submissionResponse.submission.passed, true);
    assert.equal((await incomingPromise).submissionId, "momo:2026-09-29");
    assert.equal((await repository.getSubmissions({ userId: 2 })).length, 1);

    let leakedSubmission = false;
    manager.once("manager:newSubmission", () => { leakedSubmission = true; });
    const otherIncomingPromise = once(otherManager, "manager:newSubmission");
    const otherSubmissionResponse = await emitWithAck(otherPlayer, "player:submitCompletion", {
      date: "2026-09-29",
      dmResults: [5, 4],
      rangeResults: [25, 25, 25],
      requirementsSnapshot: { dmRequired: 2, topPlacementLimit: 5, rangeRequired: 3, rangeMinScore: 25 },
      screenshotKeys: [],
      screenshotSlots: { dm: [], range: [] },
      timestamp: "2026-09-29T01:05:00.000Z",
    });
    assert.equal(otherSubmissionResponse.ok, true);
    assert.equal((await otherIncomingPromise).playerName, "Rival");
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(leakedSubmission, false);

    const forbiddenDelete = await emitWithAck(manager, "delete_submission", { submissionId: "rival:2026-09-29" });
    assert.equal(forbiddenDelete.ok, false);

    const deleteResponse = await emitWithAck(manager, "delete_submission", { submissionId: "momo:2026-09-29" });
    assert.equal(deleteResponse.ok, true);
    assert.equal((await repository.getSubmissions({ teamCode: "K9X2" })).length, 0);
    assert.equal((await repository.getSubmissions({ teamCode: "R4V4" })).length, 1);

    const offlinePromise = once(manager, "manager:playersOnline");
    player.disconnect();
    assert.deepEqual(await offlinePromise, []);

    manager.disconnect();
    refreshedManager = createClient(baseUrl, { autoConnect: false, auth: { profile: { id: 5, username: "Coach", role: "manager", teamCode: "K9X2" } } });
    const refreshedRosterPromise = once(refreshedManager, "manager:rosterSnapshot");
    const refreshedPresencePromise = once(refreshedManager, "manager:playersOnline");
    refreshedManager.connect();
    await once(refreshedManager, "connect");
    assert.deepEqual((await refreshedRosterPromise).players.map((item) => item.name), ["Momo"]);
    assert.deepEqual(await refreshedPresencePromise, []);

    const replayedRosterPromise = once(refreshedManager, "manager:rosterSnapshot");
    refreshedManager.emit("manager:join");
    assert.deepEqual((await replayedRosterPromise).players.map((item) => item.name), ["Momo"]);
  });
});
