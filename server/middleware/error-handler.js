import multer from "multer";
import { IMAGE_LIMITS } from "../config/model.js";
import { isAppError } from "../utils/app-error.js";
import { logError } from "../utils/logger.js";

function multerMessage(error) {
  if (error.code === "LIMIT_FILE_SIZE") {
    return `Image is too large. Maximum size is ${Math.round(IMAGE_LIMITS.maxBytes / 1024 / 1024)}MB.`;
  }

  if (error.code === "LIMIT_UNEXPECTED_FILE") {
    return "Unsupported upload. Use a JPEG, PNG, or WebP image in the image field.";
  }

  return "Image upload failed. Please choose a valid JPEG, PNG, or WebP file.";
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: true,
    message: "Endpoint not found.",
    details: `${req.method} ${req.originalUrl}`
  });
}

export function errorHandler(error, req, res, _next) {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 400 : 400;
    logError("upload.error", error, { method: req.method, path: req.originalUrl, status });
    res.status(status).json({
      error: true,
      message: multerMessage(error),
      details: error.code
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    logError("request.invalid_json", error, { method: req.method, path: req.originalUrl });
    res.status(400).json({
      error: true,
      message: "Invalid JSON request body.",
      details: "Check the request payload format."
    });
    return;
  }

  const status = Number(error.status || error.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;

  logError("request.error", error, {
    method: req.method,
    path: req.originalUrl,
    status: safeStatus
  });

  res.status(safeStatus).json({
    error: true,
    message: isAppError(error) ? error.message : "Unexpected server error.",
    details: isAppError(error) ? error.details || "" : "See server logs for details."
  });
}
