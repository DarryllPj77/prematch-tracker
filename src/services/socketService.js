import { io } from "socket.io-client";

let socket;
let latestTargets = null;
let currentSession = null;
const listeners = new Map();

export function connect() {
  if (socket) return socket;
  socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:3001", {
    autoConnect: Boolean(currentSession?.token),
    auth: { token: currentSession?.token || "" },
  });
  socket.on("targets:current", (targets) => { latestTargets = targets; });
  socket.on("targets:updated", (targets) => { latestTargets = targets; });
  return socket;
}

export function disconnect() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = undefined;
  latestTargets = null;
  currentSession = null;
  listeners.clear();
}

export function authenticate(profile) {
  currentSession = { token: profile.token };
  const activeSocket = connect();
  activeSocket.auth = { token: profile.token };
  if (!activeSocket.connected) activeSocket.connect();
}

export function on(event, callback) {
  connect().on(event, callback);
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  return () => {
    socket?.off(event, callback);
    listeners.get(event)?.delete(callback);
  };
}

export function emit(event, payload) {
  connect().emit(event, payload);
}

export async function emitWithAck(event, payload, timeout = 12_000) {
  const activeSocket = connect();
  if (!currentSession?.token) throw new Error("An authenticated session is required.");
  if (!activeSocket.connected) activeSocket.connect();
  const response = await activeSocket.timeout(timeout).emitWithAck(event, payload);
  if (!response?.ok) throw new Error(response?.error || "The server could not complete the request.");
  return response;
}

export function getTargets() {
  return latestTargets;
}
