import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { env, validateEnv } from "./config/env.js";
import { notFoundHandler, errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import apiRoutes from "./routes/index.js";
import { logInfo } from "./utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const uploadDir = path.resolve(__dirname, "..", "uploads");
const distDir = path.join(__dirname, "../dist");
const indexHtml = path.join(distDir, "index.html");

validateEnv();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);
app.use("/uploads", express.static(uploadDir));
app.use("/handles", express.static(path.resolve(__dirname, "..", "public", "handles")));
app.use("/api", apiRoutes(uploadDir));
app.use("/api", notFoundHandler);
app.use(express.static(distDir));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(indexHtml);
});
app.use(errorHandler);

app.listen(env.port, () => {
  logInfo("server.started", {
    url: `http://localhost:${env.port}`,
    environment: env.nodeEnv
  });
});
