import { generateHandleTryOn } from "../services/generation.service.js";
import { resolveSmartHandleProduct } from "../services/product.service.js";
import { AppError } from "../utils/app-error.js";
import { parseJsonField, validateBoundingBox, validateImageFile } from "../utils/validation.js";

export async function processImage(req, res) {
  validateImageFile(req.file);

  const handleMetadata = validateBoundingBox(
    parseJsonField(req.body.handle_metadata, "handle_metadata")
  );
  const product = resolveSmartHandleProduct(parseJsonField(req.body.product, "product"));

  if (!product?.id) {
    throw new AppError("product.id is required.", 400, "Send product as a JSON form field.");
  }

  const generation = await generateHandleTryOn({
    image: req.file,
    handleMetadata,
    product
  });

  res.json({
    source_image_url: `/uploads/${req.file.filename}`,
    ...generation
  });
}
