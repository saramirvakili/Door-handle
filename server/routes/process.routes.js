import { Router } from "express";
import { processImage } from "../controllers/process.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { createUploadMiddleware } from "../middleware/upload.js";

export default function processRoutes(uploadDir) {
  const router = Router();
  const upload = createUploadMiddleware(uploadDir);

  router.post("/process", upload.single("image"), asyncHandler(processImage));

  return router;
}
