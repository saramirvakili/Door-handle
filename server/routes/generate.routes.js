import { Router } from "express";
import { generateImage } from "../controllers/generate.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { createUploadMiddleware } from "../middleware/upload.js";

export default function generateRoutes(uploadDir) {
  const router = Router();
  const upload = createUploadMiddleware(uploadDir);

  router.post("/generate", upload.single("image"), asyncHandler(generateImage));

  return router;
}
