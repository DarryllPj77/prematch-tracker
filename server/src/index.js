import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { bearerToken, createAuthService } from "./auth.js";
import { PostgresRepository } from "./database.js";
import { registerSocketHandlers } from "./socketHandlers.js";

const clientOrigins = String(process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const repository = new PostgresRepository(process.env.DATABASE_URL);
const authService = createAuthService({
  repository,
  jwtSecret: process.env.JWT_SECRET,
  managerSignupCode: process.env.MANAGER_SIGNUP_CODE,
});
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: clientOrigins, methods: ["GET", "POST"] },
});

app.use(cors({ origin: clientOrigins }));
app.use(express.json({ limit: "1mb" }));

function sendError(response, error) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(error);
  response.status(status).json({
    error: status >= 500 ? "The server could not complete the request." : error.message,
    code: error?.code || "SERVER_ERROR",
  });
}

function requireSession(request, response, next) {
  try {
    request.profile = authService.verifyToken(bearerToken(request));
    next();
  } catch (error) {
    error.status = 401;
    error.code = "INVALID_SESSION";
    sendError(response, error);
  }
}

app.get("/health", async (_request, response) => {
  try {
    await repository.healthCheck();
    response.json({ ok: true, database: "connected" });
  } catch {
    response.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.post("/api/auth/register", async (request, response) => {
  try {
    response.status(201).json(await authService.register(request.body || {}));
  } catch (error) {
    sendError(response, error);
  }
});

app.post("/api/auth/login", async (request, response) => {
  try {
    response.json(await authService.login(request.body || {}));
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/auth/me", requireSession, (request, response) => {
  response.json(request.profile);
});

app.get("/api/submissions/mine", requireSession, async (request, response) => {
  if (request.profile.role !== "player") {
    response.status(403).json({ error: "Player access is required.", code: "FORBIDDEN" });
    return;
  }
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(request.query.date || "")) ? String(request.query.date) : undefined;
    const submissions = await repository.getSubmissions({ userId: request.profile.id, date });
    response.json({ submissions });
  } catch (error) {
    sendError(response, error);
  }
});

io.use((socket, next) => {
  try {
    socket.data.profile = authService.verifyToken(socket.handshake.auth?.token);
    next();
  } catch {
    next(new Error("Authentication required."));
  }
});

const port = process.env.PORT || 3001;

async function start() {
  await repository.initialize();
  registerSocketHandlers(io, repository);
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`PreMatch server listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error("PreMatch server failed to start:", error);
  process.exitCode = 1;
});
