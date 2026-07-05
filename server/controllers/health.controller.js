import { VISION_MODEL } from "../config/model.js";

export function getHealth(_req, res) {
  res.json({
    ok: true,
    service: "smarthandle-pro-api",
    model: VISION_MODEL
  });
}
