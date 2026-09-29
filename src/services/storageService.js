import localforage from "localforage";

const logsStore = localforage.createInstance({ name: "preMatchTracker", storeName: "logsStore" });
const mediaStore = localforage.createInstance({ name: "preMatchTracker", storeName: "mediaStore" });
const appStateStore = localforage.createInstance({ name: "preMatchTracker", storeName: "appStateStore" });
const LAST_PLAYER_NAME_KEY = "lastPlayerName";
const LOCAL_PROFILE_KEY = "localProfile";
const LOCAL_USERS_KEY = "users";

function normalizeCallsign(value) {
  return String(value || "").trim().toLowerCase();
}

function validateCredentials({ username, pin }) {
  const normalizedUsername = String(username || "").trim();
  const normalizedPin = String(pin || "");

  if (!normalizedUsername) throw new Error("A callsign is required.");
  if (!/^\d{4}$/.test(normalizedPin)) throw new Error("PIN must contain exactly four digits.");

  return { username: normalizedUsername, pin: normalizedPin };
}

export async function registerLocalUser({ username, role, pin }) {
  const credentials = validateCredentials({ username, pin });
  const normalizedRole = role === "manager" ? "manager" : role === "player" ? "player" : "";
  if (!normalizedRole) throw new Error("A valid role is required.");

  const users = (await appStateStore.getItem(LOCAL_USERS_KEY)) || {};
  const userKey = normalizeCallsign(credentials.username);
  if (users[userKey]) {
    const error = new Error("Callsign already registered.");
    error.code = "USER_EXISTS";
    throw error;
  }

  const userRecord = {
    username: credentials.username,
    role: normalizedRole,
    pin: credentials.pin,
  };
  await appStateStore.setItem(LOCAL_USERS_KEY, { ...users, [userKey]: userRecord });
  return saveLocalProfile(userRecord);
}

export async function authenticateLocalUser({ username, pin }) {
  const credentials = validateCredentials({ username, pin });
  const users = (await appStateStore.getItem(LOCAL_USERS_KEY)) || {};
  const user = users[normalizeCallsign(credentials.username)];

  if (!user || String(user.pin) !== credentials.pin || !["player", "manager"].includes(user.role)) {
    const error = new Error("Invalid callsign or PIN.");
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  return saveLocalProfile({ username: user.username, role: user.role });
}

export async function saveLocalProfile(profile) {
  const username = String(profile?.username || "").trim();
  const role = profile?.role === "manager" ? "manager" : profile?.role === "player" ? "player" : "";
  if (!username || !role) throw new Error("A display name and valid role are required.");
  const savedProfile = { username, role };
  await appStateStore.setItem(LOCAL_PROFILE_KEY, savedProfile);
  if (role === "player") await appStateStore.setItem(LAST_PLAYER_NAME_KEY, username);
  return savedProfile;
}

export async function getLocalProfile() {
  const profile = await appStateStore.getItem(LOCAL_PROFILE_KEY);
  if (!profile?.username || !["player", "manager"].includes(profile.role)) return null;
  return { username: String(profile.username).trim(), role: profile.role };
}

export async function clearLocalProfile() {
  await appStateStore.removeItem(LOCAL_PROFILE_KEY);
}

export async function saveDailyLog(logEntry) {
  const key = `log:${logEntry.playerId}:${logEntry.date}`;
  await logsStore.setItem(key, logEntry);
  return key;
}

export async function saveSubmissionData(data) {
  const sourceEntry = data?.logEntry || data;
  if (!sourceEntry?.playerId || !sourceEntry?.date) {
    throw new Error("Submission metadata requires playerId and date.");
  }

  const screenshotRecords = Array.isArray(data?.screenshots) ? data.screenshots : [];
  const newlySavedKeys = [];

  try {
    for (const record of screenshotRecords) {
      if (!record?.blob) continue;
      const uuid = String(record.uuid || record.key || crypto.randomUUID()).replace(/^shot:/, "");
      await saveScreenshot(uuid, record.blob, record.meta || {});
      newlySavedKeys.push(`shot:${uuid}`);
    }

    const screenshotKeys = [...new Set([...(sourceEntry.screenshotKeys || []), ...newlySavedKeys])];
    const persistedEntry = JSON.parse(JSON.stringify({ ...sourceEntry, screenshotKeys }));
    const key = `log:${persistedEntry.playerId}:${persistedEntry.date}`;
    await logsStore.setItem(key, persistedEntry);

    if (persistedEntry.playerName) {
      try {
        await appStateStore.setItem(LAST_PLAYER_NAME_KEY, persistedEntry.playerName);
      } catch {
        // The submission is already durable; identity fallback scans logs on the next mount.
      }
    }

    return { key, logEntry: persistedEntry };
  } catch (error) {
    await Promise.allSettled(newlySavedKeys.map((key) => mediaStore.removeItem(key)));
    throw error;
  }
}

export async function getLastPlayerName() {
  return appStateStore.getItem(LAST_PLAYER_NAME_KEY);
}

export async function deleteDailyLog({ storageKey, playerId, date }) {
  const key = storageKey || (playerId && date ? `log:${playerId}:${date}` : "");
  if (!key) throw new Error("A storage key or player/date pair is required to delete a log.");
  await logsStore.removeItem(key);
  return key;
}

export async function getLogsForPlayer(playerId) {
  const requestedPlayer = String(playerId || "").trim().toLowerCase();
  if (!requestedPlayer) return [];

  const logs = [];
  await logsStore.iterate((value, key) => {
    const storedPlayerId = String(value?.playerId || "").trim().toLowerCase();
    const storedPlayerName = String(value?.playerName || "").trim().toLowerCase();
    const keyMatches = key.toLowerCase().startsWith(`log:${requestedPlayer}:`);
    if (keyMatches || storedPlayerId === requestedPlayer || storedPlayerName === requestedPlayer) logs.push(value);
  });
  return logs.sort((left, right) => right.date.localeCompare(left.date));
}

export async function getAllLogs() {
  const logs = [];
  await logsStore.iterate((value, key) => {
    if (value) logs.push({ ...value, storageKey: key });
  });
  return logs.sort((left, right) => {
    const leftTime = left.submittedAt || left.date || "";
    const rightTime = right.submittedAt || right.date || "";
    return rightTime.localeCompare(leftTime);
  });
}

export async function saveScreenshot(uuid, blob, meta) {
  return mediaStore.setItem(`shot:${uuid}`, { blob, ...meta, createdAt: new Date().toISOString() });
}

export async function getScreenshot(uuid) {
  return mediaStore.getItem(uuid.startsWith("shot:") ? uuid : `shot:${uuid}`);
}

export async function runRetentionCleanup() {
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  let purged = 0;
  await mediaStore.iterate(async (value, key) => {
    if (new Date(value.createdAt).getTime() < cutoff) {
      await mediaStore.removeItem(key);
      purged += 1;
    }
  });
  return purged;
}
