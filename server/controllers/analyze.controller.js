import { analyzeDoorHandle } from "../services/analysis.service.js";
import { matchProduct } from "../services/product.service.js";
import { validateImageFile } from "../utils/validation.js";

export async function analyzeImage(req, res) {
  validateImageFile(req.file);

  const analysis = await analyzeDoorHandle(req.file);
  const match = matchProduct(analysis.handle_metadata);

  res.json({
    ...analysis,
    source_image_url: `/uploads/${req.file.filename}`,
    selected_product: match.selected,
    candidates: match.candidates
  });
}
