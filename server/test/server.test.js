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
      async createUser({ username, pinHash, role }) {
        const user = { id: nextId++, username, pin_hash: pinHash, role };
        users.set(username.toLowerCase(), user);
        return user;
      },
    };
    const auth = createAuthService({
      repository,
      jwtSecret: "test-secret-that-is-longer-than-thirty-two-characters",
      managerSignupCode: "manager-only",
    });

    const player = await auth.register({ username: "Momo", pin: "1234", role: "player" });
    assert.equal(player.role, "player");
    assert.notEqual(users.get("momo").pin_hash, "1234");
    assert.equal((await auth.login({ username: "momo", pin: "1234" })).username, "Momo");
    assert.equal(auth.verifyToken(player.token).username, "Momo");

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
  let player;
  let baseUrl;
  const submissions = new Map();
  let targets = structuredClone(defaultTargets);

  const repository = {
    async getTargets() { return structuredClone(targets); },
    async saveTargets(nextTargets) {
      targets = structuredClone(nextTargets);
      return structuredClone(targets);
    },
    async getSubmissions({ userId } = {}) {
      return [...submissions.values()].filter((item) => !userId || item.userId === userId);
    },
    async upsertSubmission(submission, userId) {
      const stored = {
        ...submission,
        userId,
        passed: submission.isAttended,
        dm: { placements: submission.dmResults, passed: submission.dmPassed },
        range: { scores: submission.rangeResults, passed: submission.rangePassed },
        submittedAt: submission.submittedAt,
      };
      submissions.set(submission.submissionId, stored);
      return stored;
    },
    async deleteSubmission(submissionId) {
      const existing = submissions.get(submissionId);
      submissions.delete(submissionId);
      return existing || null;
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
    player?.disconnect();
    await ioServer.close();
  });

  test("persists settings and submissions and returns database history", async () => {
    manager = createClient(baseUrl, { autoConnect: false, auth: { profile: { id: 1, username: "Coach", role: "manager" } } });
    const historyPromise = once(manager, "manager:historySnapshot");
    manager.connect();
    await once(manager, "connect");
    assert.deepEqual((await historyPromise).logs, []);

    player = createClient(baseUrl, { autoConnect: false, auth: { profile: { id: 2, username: "Momo", role: "player" } } });
    player.connect();
    await once(player, "connect");

    const settingsResponse = await emitWithAck(manager, "manager:updateTargets", {
      dm: { matchesRequired: 2, placementLimit: 5 },
      range: { roundsRequired: 3, minScore: 25 },
    });
    assert.equal(settingsResponse.ok, true);

    const incomingPromise = once(manager, "manager:newSubmission");
    const submissionResponse = await emitWithAck(player, "player:submitCompletion", {
      date: "2026-09-29",
      dmResults: [5, 3],
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

    const deleteResponse = await emitWithAck(manager, "delete_submission", { submissionId: "momo:2026-09-29" });
    assert.equal(deleteResponse.ok, true);
    assert.equal((await repository.getSubmissions()).length, 0);
  });
});
