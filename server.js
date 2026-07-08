import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeDoorImage, generateReplacement, processTryOn } from "./functions/_ai.js";
import { listProducts, suggestFromCatalog } from "./functions/_shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const distDir = path.join(__dirname, "dist");
const indexHtml = path.join(distDir, "index.html");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "smarthandle-pro-api",
    runtime: "render-web-service"
  });
});

app.get("/api/handles", (_req, res) => {
  res.json({ handles: listProducts() });
});

app.post(["/api/suggest-handles", "/api/suggest"], (req, res) => {
  res.json(suggestFromCatalog(req.body || {}));
});

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  await sendApiResponse(req, res, analyzeDoorImage);
});

app.post("/api/generate", upload.single("image"), async (req, res) => {
  await sendApiResponse(req, res, generateReplacement);
});

app.post("/api/process", upload.single("image"), async (req, res) => {
  await sendApiResponse(req, res, processTryOn);
});

app.use(express.static(distDir));

app.use((_req, res) => {
  res.sendFile(indexHtml);
});

app.use((error, _req, res, _next) => {
  const status = error?.code === "LIMIT_FILE_SIZE" ? 413 : Number(error?.status || 500);
  res.status(status).json({
    message: error?.code === "LIMIT_FILE_SIZE" ? "Image is too large for model analysis." : error.message,
    detail: error?.detail || error?.details || ""
  });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => {
    console.log(`SmartHandle Pro is running on port ${port}`);
  });
}

export default app;

async function sendApiResponse(req, res, handler) {
  try {
    const request = toWebRequest(req);
    const payload = await handler({ request, env: process.env });
    res.json(payload);
  } catch (error) {
    const status = Number(error?.status || 500);
    res.status(status).json({
      message: error?.message || "Unexpected API error.",
      detail: error?.detail || error?.details || ""
    });
  }
}

function toWebRequest(req) {
  const formData = new FormData();

  if (req.file) {
    formData.append(
      req.file.fieldname || "image",
      new File([req.file.buffer], req.file.originalname || "upload", {
        type: req.file.mimetype || "application/octet-stream"
      })
    );
  }

  for (const [key, value] of Object.entries(req.body || {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        formData.append(key, String(item));
      }
    } else if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  }

  return new Request(getAbsoluteUrl(req), {
    method: req.method,
    body: formData
  });
}

function getAbsoluteUrl(req) {
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "http";
  const host = req.get("host") || `localhost:${port}`;
  return `${protocol}://${host}${req.originalUrl || req.url}`;
}
