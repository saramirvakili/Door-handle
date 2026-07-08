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
const distPath = path.join(__dirname, "../dist");
const indexHtml = path.join(distPath, "index.html");

validateEnv();

app.use(express.static(distPath));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);
app.use("/uploads", express.static(uploadDir));
app.use("/handles", express.static(path.resolve(__dirname, "..", "public", "handles")));
app.use("/api", apiRoutes(uploadDir));
app.use("/api", notFoundHandler);

app.get("/{*splat}", (_req, res) => {
  res.sendFile(indexHtml, (error) => {
    if (!error) {
      return;
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: true,
        message: "Frontend build not found.",
        details: "Run npm run build before starting the server so dist/index.html exists."
      });
    }
  });
});
app.use(errorHandler);

app.listen(env.port, () => {
  logInfo("server.started", {
    url: `http://localhost:${env.port}`,
    environment: env.nodeEnv
  });
});
