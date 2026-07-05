import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { suggestHandles } from "../services/suggestion.service.js";

export default function suggestHandlesRoutes() {
  const router = Router();

  router.post(
    "/suggest-handles",
    asyncHandler(async (req, res) => {
      const suggestions = await suggestHandles(req.body || {});
      res.json(suggestions);
    })
  );

  return router;
}
