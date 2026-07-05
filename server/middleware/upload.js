import multer from "multer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IMAGE_LIMITS } from "../config/model.js";

export function ensureUploadDir(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export function createUploadMiddleware(uploadDir) {
  ensureUploadDir(uploadDir);

  const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${randomUUID()}${extension}`);
    }
  });

  return multer({
    storage,
    limits: {
      fileSize: IMAGE_LIMITS.maxBytes,
      files: 1
    },
    fileFilter: (_req, file, cb) => {
      if (!IMAGE_LIMITS.allowedMimeTypes.has(file.mimetype)) {
        cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "image"));
        return;
      }

      cb(null, true);
    }
  });
}
