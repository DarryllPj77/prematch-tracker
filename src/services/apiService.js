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

export function registerUser({ username, pin, role, managerCode, teamCode, teamName }) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, pin, role, managerCode, teamCode, teamName }),
  });
}

export function loginUser({ username, pin }) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, pin }),
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
