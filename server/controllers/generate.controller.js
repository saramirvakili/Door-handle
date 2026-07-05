import { generateReplacementImage } from "../services/generation.service.js";
import { getProductById } from "../services/product.service.js";
import { AppError } from "../utils/app-error.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { parseJsonField, validateBoundingBox, validateImageFile } from "../utils/validation.js";

function getOpenRouterResponseBody(error) {
  try {
    return JSON.parse(error.details || "{}").responseBody;
  } catch {
    return null;
  }
}

function parseOptionalJsonField(value, fieldName) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(`${fieldName} must be valid JSON.`, 400, `Check the ${fieldName} form field.`);
  }
}

export async function generateImage(req, res) {
  validateImageFile(req.file);

  const handleMetadata = validateBoundingBox(
    parseJsonField(req.body.handle_metadata, "handle_metadata")
  );
  const doorContext = parseOptionalJsonField(req.body.door_context, "door_context");
  const handleStyle = String(req.body.handle_style || "").trim();
  const handleMaterial = String(req.body.handle_material || "").trim();
  const handleProduct = String(req.body.handle_product || "").trim();
  const selectedHandleInput = parseOptionalJsonField(req.body.selected_handle, "selected_handle");
  const selectedHandle =
    selectedHandleInput?.id && getProductById(selectedHandleInput.id)
      ? {
          ...getProductById(selectedHandleInput.id),
          client_selected_handle: selectedHandleInput
        }
      : selectedHandleInput;

  if (!handleStyle) {
    throw new AppError(
      "handle_style is required.",
      400,
      "Send handle_style as a multipart form field."
    );
  }

  let generation;
  try {
    logInfo("generation.request_selected_handle", {
      clientId: selectedHandleInput?.id,
      clientImageUrl: selectedHandleInput?.imageUrl || selectedHandleInput?.asset_url,
      resolvedId: selectedHandle?.id,
      resolvedImageUrl: selectedHandle?.imageUrl,
      resolvedAssetUrl: selectedHandle?.asset_url
    });

    generation = await generateReplacementImage({
      image: req.file,
      handleMetadata,
      doorContext,
      handleStyle,
      handleMaterial,
      handleProduct,
      selectedHandle
    });
  } catch (error) {
    const responseBody = getOpenRouterResponseBody(error);
    if (responseBody) {
      logWarn("openrouter.generate.error_body", {
        status: error.status,
        responseBody
      });
    }
    throw error;
  }

  res.json({
    source_image_url: `/uploads/${req.file.filename}`,
    selected_handle: selectedHandle,
    ...generation
  });
}
