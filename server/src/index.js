import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { bearerToken, createAuthService } from "./auth.js";
import { PostgresRepository } from "./database.js";
import { createScreenshotStorage } from "./screenshotStorage.js";
import { registerSocketHandlers } from "./socketHandlers.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDirectory, "../..");
const isProduction = process.env.NODE_ENV === "production";

if (!isProduction) {
  dotenv.config({ path: path.join(projectRoot, "server/.env"), quiet: true });
  dotenv.config({ path: path.join(projectRoot, ".env.local"), quiet: true });
}

const databaseUrl = isProduction
  ? process.env.DATABASE_URL
  : process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET
  || (!isProduction ? "prematch-local-development-jwt-secret-2026" : "");
const managerSignupCode = process.env.MANAGER_SIGNUP_CODE
  || (!isProduction ? "LOCAL-MANAGER-CODE" : "");
const clientOrigins = String(process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const repository = new PostgresRepository(databaseUrl);
const screenshotStorage = createScreenshotStorage();
const authService = createAuthService({
  repository,
  jwtSecret,
  managerSignupCode,
  authDebug: process.env.AUTH_DEBUG === "true",
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

async function requireSession(request, response, next) {
  try {
    request.profile = await authService.verifySession(bearerToken(request));
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
    response.json({
      ok: true,
      database: "connected",
      screenshotStorage: screenshotStorage.configured ? "configured" : "unavailable",
    });
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

app.post("/api/auth/reset-pin", async (request, response) => {
  try {
    response.json(await authService.resetPin(request.body || {}));
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

app.post(
  "/api/screenshots",
  requireSession,
  express.raw({ type: "image/*", limit: "8mb" }),
  async (request, response) => {
    if (request.profile.role !== "player") {
      response.status(403).json({ error: "Player access is required.", code: "FORBIDDEN" });
      return;
    }
    try {
      const screenshotKey = await screenshotStorage.upload({
        profile: request.profile,
        body: request.body,
        contentType: String(request.headers["content-type"] || "").split(";")[0].toLowerCase(),
        capturedFor: request.headers["x-screenshot-slot"],
      });
      response.status(201).json({ screenshotKey });
    } catch (error) {
      sendError(response, error);
    }
  },
);

app.get("/api/screenshots", requireSession, async (request, response) => {
  try {
    const screenshot = await screenshotStorage.download({
      profile: request.profile,
      screenshotKey: request.query.key,
    });
    response.set("Cache-Control", "private, max-age=300");
    response.type(screenshot.contentType).send(screenshot.body);
  } catch (error) {
    sendError(response, error);
  }
});

app.delete("/api/screenshots", requireSession, async (request, response) => {
  try {
    await screenshotStorage.deleteOne({
      profile: request.profile,
      screenshotKey: request.query.key,
    });
    response.status(204).end();
  } catch (error) {
    sendError(response, error);
  }
});

io.use(async (socket, next) => {
  try {
    socket.data.profile = await authService.verifySession(socket.handshake.auth?.token);
    next();
  } catch {
    next(new Error("Authentication required."));
  }
});

const port = process.env.PORT || 3001;

async function start() {
  await repository.initialize();
  registerSocketHandlers(io, repository, screenshotStorage);
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`PreMatch server listening on port ${port} (${isProduction ? "production" : "local development"})`);
  });
}

start().catch((error) => {
  console.error("PreMatch server failed to start:", error);
  process.exitCode = 1;
});
