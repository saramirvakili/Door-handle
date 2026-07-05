import { Router } from "express";
import { listProducts } from "../services/product.service.js";

export default function handlesRoutes() {
  const router = Router();

  router.get("/handles", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ handles: listProducts() });
  });

  return router;
}
