import localforage from "localforage";
import { downloadScreenshot, removeScreenshot, uploadScreenshot } from "./apiService.js";

const logsStore = localforage.createInstance({ name: "preMatchTracker", storeName: "logsStore" });
const mediaStore = localforage.createInstance({ name: "preMatchTracker", storeName: "mediaStore" });
const appStateStore = localforage.createInstance({ name: "preMatchTracker", storeName: "appStateStore" });
const LAST_PLAYER_NAME_KEY = "lastPlayerName";
const LOCAL_PROFILE_KEY = "localProfile";
const LEGACY_LOCAL_USERS_KEY = "users";

export async function saveLocalProfile(profile) {
  const username = String(profile?.username || "").trim();
  const role = profile?.role === "manager" ? "manager" : profile?.role === "player" ? "player" : "";
  const token = String(profile?.token || "");
  const teamCode = String(profile?.teamCode || "").trim().toUpperCase();
  const teamName = String(profile?.teamName || "").trim();
  if (!username || !role || !token || !/^[A-Z0-9]{4}$/.test(teamCode) || !teamName) throw new Error("A complete authenticated profile is required.");
  const savedProfile = { id: Number(profile.id), username, role, teamCode, teamName, token };
  await appStateStore.setItem(LOCAL_PROFILE_KEY, savedProfile);
  await appStateStore.removeItem(LEGACY_LOCAL_USERS_KEY).catch(() => {});
  if (role === "player") await appStateStore.setItem(LAST_PLAYER_NAME_KEY, username);
  return savedProfile;
}

export async function getLocalProfile() {
  const profile = await appStateStore.getItem(LOCAL_PROFILE_KEY);
  if (!profile?.username || !profile?.token || !["player", "manager"].includes(profile.role) || !/^[A-Z0-9]{4}$/.test(String(profile.teamCode || ""))) return null;
  return { id: Number(profile.id), username: String(profile.username).trim(), role: profile.role, teamCode: profile.teamCode, teamName: String(profile.teamName || "").trim(), token: profile.token };
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

export async function getSubmissionForPlayerDate(playerId, date) {
  if (!date) return null;
  const logs = await getLogsForPlayer(playerId);
  return logs.find((log) => log.date === date) || null;
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
  const localKey = `shot:${uuid}`;
  const createdAt = new Date().toISOString();
  const localRecord = { blob, ...meta, createdAt };
  await mediaStore.setItem(localKey, localRecord);

  const profile = await getLocalProfile();
  if (!profile?.token) return localKey;

  const uploaded = await uploadScreenshot(profile.token, blob, meta);
  const screenshotKey = String(uploaded?.screenshotKey || "");
  if (!screenshotKey.startsWith("remote:")) throw new Error("The server returned an invalid screenshot key.");
  await mediaStore.setItem(screenshotKey, { ...localRecord, remote: true });
  await mediaStore.removeItem(localKey);
  return screenshotKey;
}

export async function getScreenshot(uuid) {
  const screenshotKey = uuid.startsWith("shot:") || uuid.startsWith("remote:") ? uuid : `shot:${uuid}`;
  const cached = await mediaStore.getItem(screenshotKey);
  if (cached?.blob || !screenshotKey.startsWith("remote:")) return cached;

  const profile = await getLocalProfile();
  if (!profile?.token) return null;
  const blob = await downloadScreenshot(profile.token, screenshotKey);
  const record = { blob, remote: true, createdAt: new Date().toISOString() };
  await mediaStore.setItem(screenshotKey, record);
  return record;
}

export async function deleteScreenshot(screenshotKey) {
  if (!screenshotKey) return false;
  await mediaStore.removeItem(screenshotKey);
  if (!String(screenshotKey).startsWith("remote:")) return true;
  const profile = await getLocalProfile();
  return profile?.token ? removeScreenshot(profile.token, screenshotKey) : false;
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
