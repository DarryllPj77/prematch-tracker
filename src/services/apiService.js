const API_URL = String(import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || "http://localhost:3001").replace(/\/$/, "");

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    const error = new Error("The PreMatch server is unavailable.");
    error.code = "SERVER_UNAVAILABLE";
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "The request could not be completed.");
    error.code = payload.code || "REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function registerUser({ username, pin, role, managerCode, teamCode, teamName, intent }) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, pin, role, managerCode, teamCode, teamName, intent }),
  });
}

export function loginUser({ username, pin }) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, pin }),
  });
}

export function resetPin({ callsign, teamCode, newPin }) {
  return request("/api/auth/reset-pin", {
    method: "POST",
    body: JSON.stringify({ callsign, teamCode, newPin }),
  });
}

export function getCurrentUser(token) {
  return request("/api/auth/me", { token });
}

export async function getMySubmissions(token, date = "") {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const payload = await request(`/api/submissions/mine${query}`, { token });
  return Array.isArray(payload.submissions) ? payload.submissions : [];
}

export function uploadScreenshot(token, file, metadata = {}) {
  return request("/api/screenshots", {
    token,
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Screenshot-Slot": String(metadata.capturedFor || "proof").slice(0, 64),
    },
    body: file,
  });
}

export async function downloadScreenshot(token, screenshotKey) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/screenshots?key=${encodeURIComponent(screenshotKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    const error = new Error("The PreMatch server is unavailable.");
    error.code = "SERVER_UNAVAILABLE";
    throw error;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || "The screenshot could not be downloaded.");
    error.code = payload.code || "SCREENSHOT_DOWNLOAD_FAILED";
    error.status = response.status;
    throw error;
  }
  return response.blob();
}

export async function removeScreenshot(token, screenshotKey) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/screenshots?key=${encodeURIComponent(screenshotKey)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return false;
  }
  return response.ok;
}
