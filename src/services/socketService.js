import { io } from "socket.io-client";

let socket;
let latestTargets = null;
let currentIdentity = null;
const listeners = new Map();

export function connect() {
  if (socket) return socket;
  socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:3001");
  socket.on("connect", () => {
    if (currentIdentity) socket.emit("auth:identify", currentIdentity);
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
  currentIdentity = null;
  listeners.clear();
}

export function authenticate(profile) {
  currentIdentity = { username: profile.username, role: profile.role };
  const activeSocket = connect();
  if (activeSocket.connected) activeSocket.emit("auth:identify", currentIdentity);
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

export function getTargets() {
  return latestTargets;
}
