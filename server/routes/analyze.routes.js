import { Router } from "express";
import { analyzeImage } from "../controllers/analyze.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { createUploadMiddleware } from "../middleware/upload.js";

export default function analyzeRoutes(uploadDir) {
  const router = Router();
  const upload = createUploadMiddleware(uploadDir);

  router.post("/analyze", upload.single("image"), asyncHandler(analyzeImage));

  return router;
}
