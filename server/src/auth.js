import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

function createAuthError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
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

export function createAuthService({ repository, jwtSecret, managerSignupCode }) {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters.");
  }

  const issueSession = (user) => {
    const profile = { id: Number(user.id), username: user.username, role: user.role };
    const token = jwt.sign(profile, jwtSecret, { subject: String(user.id), expiresIn: "7d" });
    return { ...profile, token };
  };

  const verifyToken = (token) => {
    const payload = jwt.verify(token, jwtSecret);
    if (!payload?.sub || !payload?.username || !["player", "manager"].includes(payload.role)) {
      throw createAuthError("Invalid session.", "INVALID_SESSION", 401);
    }
    return { id: Number(payload.sub), username: payload.username, role: payload.role };
  };

  return {
    async register({ username, pin, role, managerCode }) {
      const credentials = validateCredentials({ username, pin });
      const normalizedRole = role === "manager" ? "manager" : role === "player" ? "player" : "";
      if (!normalizedRole) throw createAuthError("A valid role is required.", "INVALID_ROLE");
      if (normalizedRole === "manager" && (!managerSignupCode || managerCode !== managerSignupCode)) {
        throw createAuthError("The manager registration code is invalid.", "INVALID_MANAGER_CODE", 403);
      }

      const existing = await repository.findUserByUsername(credentials.username);
      if (existing) throw createAuthError("Callsign already registered.", "USER_EXISTS", 409);

      const pinHash = await bcrypt.hash(credentials.pin, 12);
      try {
        const user = await repository.createUser({ username: credentials.username, pinHash, role: normalizedRole });
        return issueSession(user);
      } catch (error) {
        if (error?.code === "23505") throw createAuthError("Callsign already registered.", "USER_EXISTS", 409);
        throw error;
      }
    },

    async login({ username, pin }) {
      const credentials = validateCredentials({ username, pin });
      const user = await repository.findUserByUsername(credentials.username);
      const valid = user ? await bcrypt.compare(credentials.pin, user.pin_hash) : false;
      if (!valid) throw createAuthError("Invalid callsign or PIN.", "INVALID_CREDENTIALS", 401);
      return issueSession(user);
    },

    verifyToken,
  };
}

export function bearerToken(request) {
  const value = String(request.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}
