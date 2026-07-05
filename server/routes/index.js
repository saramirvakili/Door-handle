import { Router } from "express";
import analyzeRoutes from "./analyze.routes.js";
import generateRoutes from "./generate.routes.js";
import handlesRoutes from "./handles.routes.js";
import healthRoutes from "./health.routes.js";
import processRoutes from "./process.routes.js";
import suggestHandlesRoutes from "./suggest-handles.routes.js";

export default function apiRoutes(uploadDir) {
  const router = Router();

  router.use(healthRoutes);
  router.use(handlesRoutes());
  router.use(analyzeRoutes(uploadDir));
  router.use(generateRoutes(uploadDir));
  router.use(suggestHandlesRoutes());
  router.use(processRoutes(uploadDir));

  return router;
}
