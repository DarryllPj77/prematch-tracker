import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { generateTeamCode, isValidTeamCode, normalizeTeamCode } from "./teamCodes.js";

function createAuthError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateCredentials({ username, pin }) {
  const normalizedUsername = String(username || "").trim();
  const normalizedPin = String(pin || "");
  if (!normalizedUsername || normalizedUsername.length > 32) {
    throw createAuthError("A callsign between 1 and 32 characters is required.", "INVALID_CALLSIGN");
  }
  if (!/^\d{4}$/.test(normalizedPin)) {
    throw createAuthError("PIN must contain exactly four digits.", "INVALID_PIN");
  }
  return { username: normalizedUsername, pin: normalizedPin };
}

function validateTeamName(value) {
  const teamName = String(value || "").trim();
  if (!teamName || teamName.length > 64) {
    throw createAuthError("Premier Team Name must contain between 1 and 64 characters.", "INVALID_TEAM_NAME");
  }
  return teamName;
}

export function createAuthService({ repository, jwtSecret, managerSignupCode }) {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters.");
  }

  const getTeamName = async (teamCode) => {
    const manager = await repository.findManagerByTeamCode(teamCode);
    const teamName = String(manager?.team_name || manager?.teamName || "").trim();
    if (!teamName) {
      throw createAuthError("This team does not have a Premier Team Name.", "TEAM_ASSIGNMENT_REQUIRED", 403);
    }
    return teamName;
  };

  const issueSession = async (user) => {
    const teamCode = normalizeTeamCode(user.team_code || user.teamCode);
    if (!isValidTeamCode(teamCode)) {
      throw createAuthError(
        "This account is not assigned to a team. Register again with your existing callsign, PIN, and a valid Team Invite Code.",
        "TEAM_ASSIGNMENT_REQUIRED",
        403,
      );
    }
    const teamName = await getTeamName(teamCode);
    const profile = { id: Number(user.id), username: user.username, role: user.role, teamCode, teamName };
    const token = jwt.sign(profile, jwtSecret, { subject: String(user.id), expiresIn: "7d" });
    return { ...profile, token };
  };

  const verifyToken = (token) => {
    const payload = jwt.verify(token, jwtSecret);
    if (!payload?.sub || !payload?.username || !["player", "manager"].includes(payload.role) || !isValidTeamCode(payload.teamCode)) {
      throw createAuthError("Invalid session.", "INVALID_SESSION", 401);
    }
    return { id: Number(payload.sub), username: payload.username, role: payload.role, teamCode: normalizeTeamCode(payload.teamCode), teamName: String(payload.teamName || "").trim() };
  };

  const verifySession = async (token) => {
    const profile = verifyToken(token);
    const user = await repository.findUserById(profile.id);
    const currentTeamCode = normalizeTeamCode(user?.team_code);
    if (
      !user
      || user.role !== profile.role
      || normalizeUsername(user.username) !== normalizeUsername(profile.username)
      || currentTeamCode !== profile.teamCode
    ) {
      throw createAuthError("This session is no longer assigned to that team.", "INVALID_SESSION", 401);
    }
    const teamName = await getTeamName(currentTeamCode);
    return { id: Number(user.id), username: user.username, role: user.role, teamCode: currentTeamCode, teamName };
  };

  return {
    async register({ username, pin, role, managerCode, teamCode, teamName }) {
      const credentials = validateCredentials({ username, pin });
      const normalizedRole = role === "manager" ? "manager" : role === "player" ? "player" : "";
      if (!normalizedRole) throw createAuthError("A valid role is required.", "INVALID_ROLE");
      if (normalizedRole === "manager" && (!managerSignupCode || managerCode !== managerSignupCode)) {
        throw createAuthError("The manager registration code is invalid.", "INVALID_MANAGER_CODE", 403);
      }
      const requestedTeamName = normalizedRole === "manager" ? validateTeamName(teamName) : null;

      const requestedTeamCode = normalizeTeamCode(teamCode);
      if (normalizedRole === "player") {
        const manager = isValidTeamCode(requestedTeamCode)
          ? await repository.findManagerByTeamCode(requestedTeamCode)
          : null;
        if (!manager) throw createAuthError("Invalid Team Code", "INVALID_TEAM_CODE");
      }

      const existing = await repository.findUserByUsername(credentials.username);
      if (existing) {
        if (normalizedRole === "player" && existing.role === "player" && !existing.team_code) {
          const validPin = await bcrypt.compare(credentials.pin, existing.pin_hash);
          if (!validPin) throw createAuthError("Callsign already registered.", "USER_EXISTS", 409);
          const assigned = await repository.assignPlayerToTeam(existing.id, requestedTeamCode);
          if (assigned) return issueSession(assigned);
        }
        throw createAuthError("Callsign already registered.", "USER_EXISTS", 409);
      }

      const pinHash = await bcrypt.hash(credentials.pin, 12);
      const attempts = normalizedRole === "manager" ? 32 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const assignedTeamCode = normalizedRole === "manager" ? generateTeamCode() : requestedTeamCode;
          const user = await repository.createUser({
            username: credentials.username,
            pinHash,
            role: normalizedRole,
            teamCode: assignedTeamCode,
            teamName: requestedTeamName,
          });
          return issueSession(user);
        } catch (error) {
          const teamCodeCollision = error?.code === "23505" && error?.constraint === "users_manager_team_code_key";
          if (teamCodeCollision && attempt + 1 < attempts) continue;
          if (error?.code === "23505") throw createAuthError("Callsign already registered.", "USER_EXISTS", 409);
          throw error;
        }
      }
      throw createAuthError("A unique team code could not be generated. Try again.", "TEAM_CODE_GENERATION_FAILED", 503);
    },

    async login({ username, pin }) {
      const credentials = validateCredentials({ username, pin });
      const user = await repository.findUserByUsername(credentials.username);
      const valid = user ? await bcrypt.compare(credentials.pin, user.pin_hash) : false;
      if (!valid) throw createAuthError("Invalid callsign or PIN.", "INVALID_CREDENTIALS", 401);
      return issueSession(user);
    },

    async resetPin({ callsign, teamCode, newPin }) {
      const credentials = validateCredentials({ username: callsign, pin: newPin });
      const requestedTeamCode = normalizeTeamCode(teamCode);
      const user = isValidTeamCode(requestedTeamCode)
        ? await repository.findUserByUsername(credentials.username)
        : null;

      if (
        !user
        || user.role !== "player"
        || normalizeTeamCode(user.team_code) !== requestedTeamCode
      ) {
        throw createAuthError("Invalid Callsign or Team Code", "INVALID_RECOVERY", 401);
      }

      const pinHash = await bcrypt.hash(credentials.pin, 12);
      const updatedUser = await repository.updateUserPin(user.id, pinHash, requestedTeamCode);
      if (!updatedUser) {
        throw createAuthError("Invalid Callsign or Team Code", "INVALID_RECOVERY", 401);
      }
      return issueSession(updatedUser);
    },

    verifyToken,
    verifySession,
  };
}

export function bearerToken(request) {
  const value = String(request.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}
