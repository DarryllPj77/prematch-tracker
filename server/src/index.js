import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./socketHandlers.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] },
});

app.use(cors({ origin: "http://localhost:5173" }));
app.get("/health", (_request, response) => response.json({ ok: true }));

// This server is a relay only. It has no database; historical data stays client-side in localForage.
registerSocketHandlers(io);

const port = process.env.PORT || 3001;
httpServer.listen(port, () => {
  console.log(`PreMatch relay listening on http://localhost:${port}`);
});
