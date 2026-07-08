import { generateReplacementImage } from "../services/generation.service.js";
import { getProductById, resolveSmartHandleProduct } from "../services/product.service.js";
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
  const catalogHandle = selectedHandleInput?.id ? getProductById(selectedHandleInput.id) : null;
  const selectedHandle = resolveSmartHandleProduct(
    catalogHandle ? { ...catalogHandle, client_selected_handle: selectedHandleInput } : null
  );

  if (!handleStyle) {
    throw new AppError(
      "handle_style is required.",
      400,
      "Send handle_style as a multipart form field."
    );
  }

  if (!selectedHandleInput?.id) {
    throw new AppError(
      "selected_handle.id is required.",
      400,
      "Select a handle before generating the preview."
    );
  }

  if (!selectedHandle?.id || !selectedHandle?.imageUrl) {
    throw new AppError(
      "Selected handle could not be resolved.",
      400,
      `Handle ${selectedHandleInput.id} is not available in the live catalog.`
    );
  }

  let generation;
  try {
    console.log(`Processing handle: ${selectedHandle.name || selectedHandle.id}`);
    logInfo("generation.request_selected_handle", {
      clientId: selectedHandleInput?.id,
      clientImageUrl: selectedHandleInput?.imageUrl || selectedHandleInput?.asset_url,
      resolvedId: selectedHandle?.id,
      resolvedImageUrl: selectedHandle?.imageUrl,
      resolvedAssetUrl: selectedHandle?.asset_url,
      resolvedSide: selectedHandle?.side,
      resolvedPosition: selectedHandle?.position,
      isSmartHandle: selectedHandle?.isSmartHandle
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
