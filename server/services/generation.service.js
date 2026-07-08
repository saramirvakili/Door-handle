import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { IMAGE_GENERATION_MODEL, VISION_MODEL } from "../config/model.js";
import { AppError } from "../utils/app-error.js";
import { logInfo } from "../utils/logger.js";
import { createOpenRouterClient } from "./openrouter.service.js";
import { resolveSmartHandleProduct } from "./product.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "..", "public");
const CONSERVATIVE_DOOR_DESCRIPTION = "decorative wooden door with carved geometric motifs";

function getMimeTypeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function normalizeHandleAssetUrl(selectedHandle) {
  selectedHandle = resolveSmartHandleProduct(selectedHandle);
  const imageUrl = selectedHandle?.imageUrl || selectedHandle?.asset_url;
  if (!imageUrl || typeof imageUrl !== "string") return null;
  if (imageUrl.startsWith("http") || imageUrl.startsWith("data:")) return imageUrl;
  if (imageUrl.startsWith("/handles/")) return imageUrl;

  const legacyAssetMatch = imageUrl.match(/\/assets\/handles\/handle-(\d+)\.(png|jpe?g|webp)$/i);
  if (legacyAssetMatch) {
    return `/handles/${Number(legacyAssetMatch[1])}.${legacyAssetMatch[2].toLowerCase()}`;
  }

  return imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
}

function publicHandleAssetUrl(selectedHandle) {
  selectedHandle = resolveSmartHandleProduct(selectedHandle);
  const assetUrl = normalizeHandleAssetUrl(selectedHandle);
  if (!assetUrl || assetUrl.startsWith("http") || assetUrl.startsWith("data:")) return assetUrl;
  const apiBaseUrl = process.env.PUBLIC_API_URL || `http://localhost:${env.port}`;
  return `${apiBaseUrl.replace(/\/+$/, "")}${assetUrl}`;
}

async function getSelectedHandleReferenceImage(selectedHandle) {
  selectedHandle = resolveSmartHandleProduct(selectedHandle);
  const imageUrl = normalizeHandleAssetUrl(selectedHandle);
  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.startsWith("/handles/")) {
    return null;
  }

  const assetPath = path.resolve(publicDir, imageUrl.slice(1));
  if (!assetPath.startsWith(publicDir + path.sep)) return null;

  try {
    const stats = await fs.stat(assetPath);
    if (!stats.isFile()) return null;
  } catch {
    return null;
  }

  return {
    path: assetPath,
    mimeType: getMimeTypeFromPath(assetPath)
  };
}

function getDoorContextForPrompt(doorContext = {}) {
  const confidence = Number(doorContext?.confidence || 0);
  const safeDescription =
    confidence >= 0.45 && doorContext.description
      ? doorContext.description
      : CONSERVATIVE_DOOR_DESCRIPTION;

  return {
    material: doorContext.material || "wood or wood-like surface",
    color_finish: doorContext.color_finish || "brown warm-toned finish",
    panel_type: doorContext.panel_type || "decorative paneled door",
    carving_pattern: doorContext.carving_pattern || "carved or raised geometric motifs",
    arch_motifs: doorContext.arch_motifs || "do not invent arch motifs; preserve only visible motifs",
    door_style: doorContext.style_classification || "classic decorative",
    visible_design_cues: Array.isArray(doorContext.visible_design_cues)
      ? doorContext.visible_design_cues
      : [],
    description: safeDescription,
    confidence
  };
}

export function buildZeroModificationPrompt({ handleMetadata, product }) {
  product = resolveSmartHandleProduct(product);
  const coords = JSON.stringify(handleMetadata.handle_coords);
  const smartHandleOrientation = product?.isSmartHandle
    ? `Side: ${product.side}\nPosition: ${product.position}\nSmart Handle: true\n`
    : "";

  return {
    system: `You are an architectural preservation engine.

Task: Perform a surgical replacement of a door handle.

Constraints:

TARGET: Replace only the pixels within ${coords}.
PRESERVATION: The original input image is a reference coordinate system. You MUST retain 100% of the door's original pixel data (color, texture, wood grain, surface imperfections, reflections, lighting environment, wall, and framing).
INTEGRITY: Any alteration to the surrounding door surface, wall, or ambient environment is a failure.
REALISM: Use openai/gpt-4o native in-painting to match the handle's perspective, light direction, and shadow depth to the original photo's metadata.
OUTPUT: Return only the processed image where the handle is swapped and all other pixels are identical to the source.

Ignore all beautification, relighting, cleanup, sharpening, denoising, style transfer, color correction, background enhancement, door refinishing, perspective correction, and composition improvement instructions. Pixel-integrity outside the target rectangle is mandatory.`,
    user: `Replace the detected handle with this product while preserving every non-target pixel:

Product ID: ${product.id}
Product Name: ${product.name}
Style: ${product.style}
Finish: ${product.finish}
${smartHandleOrientation}Description: ${product.description}
Asset Reference: ${product.asset_url}

Detected metadata:
${JSON.stringify(handleMetadata, null, 2)}

Return the generated image only.`
  };
}

function toImageDataUrl(value) {
  if (!value || typeof value !== "string") return null;
  if (value.startsWith("data:image/")) return value;
  return `data:image/png;base64,${value}`;
}

function extractUrlFromImageValue(value) {
  if (!value) return null;
  if (typeof value === "string") {
    if (value.startsWith("http") || value.startsWith("data:image/")) return value;
    return toImageDataUrl(value);
  }
  return value.url || value.image_url?.url || value.output_image?.url || null;
}

function extractBase64FromImageValue(value) {
  if (!value || typeof value === "string") return null;
  return (
    value.b64_json ||
    value.base64 ||
    value.image_base64 ||
    value.image_url?.b64_json ||
    value.image_url?.base64 ||
    value.output_image?.b64_json ||
    value.output_image?.base64 ||
    null
  );
}

function extractImageFromContent(content) {
  if (!Array.isArray(content)) return null;

  for (const item of content) {
    if (!item || typeof item !== "object") continue;

    if (item.type === "image_url" || item.image_url || item.output_image) {
      const url = extractUrlFromImageValue(item.image_url || item.output_image || item);
      if (url) return url;

      const base64 = extractBase64FromImageValue(item.image_url || item.output_image || item);
      if (base64) return toImageDataUrl(base64);
    }

    const directUrl = item.url || item.image?.url || item.source?.url;
    if (directUrl) return directUrl;

    const directBase64 =
      item.b64_json || item.base64 || item.image_base64 || item.image?.b64_json;
    if (directBase64) return toImageDataUrl(directBase64);
  }

  return null;
}

function findImageDeep(value, depth = 0) {
  if (!value || depth > 6) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const image = findImageDeep(item, depth + 1);
      if (image) return image;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  const directUrl = extractUrlFromImageValue(value.image_url || value.output_image || value.image);
  if (directUrl) return directUrl;

  const directBase64 = extractBase64FromImageValue(value);
  if (directBase64) return toImageDataUrl(directBase64);

  if (typeof value.url === "string" && (value.url.startsWith("http") || value.url.startsWith("data:image/"))) {
    return value.url;
  }

  for (const child of Object.values(value)) {
    const image = findImageDeep(child, depth + 1);
    if (image) return image;
  }

  return null;
}

function extractGeneratedImage(result) {
  const payload = result?.data && !Array.isArray(result.data) ? result.data : result;

  const standardDataItems = [
    ...(Array.isArray(result?.data?.data) ? result.data.data : []),
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(result?.data) ? result.data : []),
    ...(Array.isArray(payload?.images) ? payload.images : []),
    ...(Array.isArray(result?.images) ? result.images : [])
  ];

  for (const item of standardDataItems) {
    const url = extractUrlFromImageValue(item);
    if (url) return url;

    const base64 = extractBase64FromImageValue(item);
    if (base64) return toImageDataUrl(base64);
  }

  const message = payload?.choices?.[0]?.message || result?.choices?.[0]?.message;
  const messageImageUrl = extractUrlFromImageValue(message?.image_url);
  if (messageImageUrl) return messageImageUrl;

  const messageImageBase64 = extractBase64FromImageValue(message?.image_url || message);
  if (messageImageBase64) return toImageDataUrl(messageImageBase64);

  return extractImageFromContent(message?.content) || findImageDeep(payload) || findImageDeep(result);
}

export function buildHandleReplacementPrompt({
  handleMetadata,
  doorContext,
  handleStyle,
  handleMaterial,
  handleProduct,
  selectedHandle
}) {
  selectedHandle = resolveSmartHandleProduct(selectedHandle);
  if (!selectedHandle?.id || !selectedHandle?.imageUrl) {
    throw new AppError(
      "Selected handle is required for generation.",
      400,
      "Choose a handle from the live catalog before generating the preview."
    );
  }

  const coords = JSON.stringify(handleMetadata.handle_coords);
  const door = getDoorContextForPrompt(doorContext);
  const handle_style = selectedHandle.style;
  const handle_material = selectedHandle.material;
  const product = selectedHandle.name;
  const handle_finish = selectedHandle.finish;
  const description = selectedHandle.description;
  const productId = selectedHandle.id;
  const assetReference = normalizeHandleAssetUrl(selectedHandle) || "no asset selected";
  const publicAssetReference = publicHandleAssetUrl(selectedHandle) || "no public asset URL available";
  const smartHandleInstructions = selectedHandle?.isSmartHandle
    ? `
SMART HANDLE ORIENTATION:
- This selected product is a smart handle.
- Always use ONLY the right-side exterior handle variant.
- Final resolved handle side: ${selectedHandle.side}
- Final resolved handle position: ${selectedHandle.position}
- Never use a left-side, interior, mirrored, or first-available smart-handle asset.`
    : "";

  return {
    user: `You are an expert image editor. Look at the attached image of a door.
The first attached image is the door to edit. If a second attached image is present, it is the exact selected handle reference from the suggestion card.
Your task is to modify ONLY the door handle and keep EVERYTHING else 100% identical.

STRICT CONSTRAINTS:
- Do NOT regenerate the door, the wood texture, the grain, the color, or the panels.
- Do NOT change the wall, light switch, door frame, or surrounding environment. Every single pixel outside the door handle area must remain exactly the same.
- Never redesign the whole door. Preserve original door geometry, carvings, patterns, proportions, and structure.
- Locate the door handle at these coordinates: ${coords}.

A) DOOR CONTEXT FROM ANALYSIS. Use this only to preserve the original door and fit the handle naturally. Do not derive handle identity from this section.
  * door_description: ${door.description}
  * door_material: ${door.material}
  * door_color_finish: ${door.color_finish}
  * door_panel_type: ${door.panel_type}
  * door_carving_or_geometric_pattern: ${door.carving_pattern}
  * door_arch_motifs: ${door.arch_motifs}
  * door_style: ${door.door_style}
  * door_visible_design_cues: ${door.visible_design_cues.join("; ") || "none confidently visible"}
  * door_analysis_confidence: ${door.confidence}
  * If door_analysis_confidence is low, preserve visible pixels and use the conservative description "${CONSERVATIVE_DOOR_DESCRIPTION}" instead of guessing a modern/simple style.

B) SELECTED HANDLE FROM USER SELECTION. Replace the existing handle with exactly this selected handle. Do not choose a default, catalog, or first suggestion when a selected handle is provided:
  * Selected Handle ID: ${productId}
  * Selected Handle Image/Asset: ${assetReference}
  * Selected Handle Public URL: ${publicAssetReference}
  * handle_style: ${handle_style}
  * handle_material: ${handle_material}
  * handle_finish: ${handle_finish}
  * handle_product_name: ${product}
  * handle_description: ${description}
  * isSmartHandle: ${selectedHandle?.isSmartHandle ? "true" : "false"}
  * resolved_handle_side: ${selectedHandle?.side || "unspecified"}
  * resolved_handle_position: ${selectedHandle?.position || "unspecified"}${smartHandleInstructions}
- Never swap the selected handle for a different design. Never improvise another handle style.
- The new handle must match the perspective, lighting, and shadow of the door perfectly.
- Output ONLY the modified image.`
  };
}

export async function generateHandleTryOn({ image, handleMetadata, product }) {
  product = resolveSmartHandleProduct(product);
  if (product?.isSmartHandle) {
    logInfo("smart_handle.resolved_side", {
      id: product.id,
      side: product.side,
      position: product.position,
      imageUrl: product.imageUrl,
      asset_url: product.asset_url
    });
  }
  console.log(`Processing handle: ${product.name || product.id}`);
  const prompt = buildZeroModificationPrompt({ handleMetadata, product });
  const openRouter = createOpenRouterClient();

  const result = await openRouter.callVisionModel(image.path, prompt, {
    mimeType: image.mimetype,
    temperature: 0
  });

  const outputImageUrl = extractGeneratedImage(result);
  if (!outputImageUrl) {
    throw new AppError(
      "The visual model did not return a processed image.",
      502,
      "OpenRouter returned a successful response without an image URL."
    );
  }

  return {
    model: VISION_MODEL,
    prompt,
    output_image_url: outputImageUrl
  };
}

export async function generateReplacementImage({
  image,
  handleMetadata,
  doorContext,
  handleStyle,
  handleMaterial,
  handleProduct,
  selectedHandle
}) {
  selectedHandle = resolveSmartHandleProduct(selectedHandle);
  if (selectedHandle?.isSmartHandle) {
    logInfo("smart_handle.resolved_side", {
      id: selectedHandle.id,
      side: selectedHandle.side,
      position: selectedHandle.position,
      imageUrl: selectedHandle.imageUrl,
      asset_url: selectedHandle.asset_url
    });
  }
  const prompt = buildHandleReplacementPrompt({
    handleMetadata,
    doorContext,
    handleStyle,
    handleMaterial,
    handleProduct,
    selectedHandle
  });
  const selectedHandleReferenceImage = await getSelectedHandleReferenceImage(selectedHandle);
  const openRouter = createOpenRouterClient();

  if (selectedHandle?.id && !selectedHandleReferenceImage) {
    throw new AppError(
      "Selected handle reference image could not be resolved.",
      400,
      JSON.stringify({
        selectedHandleId: selectedHandle.id,
        imageUrl: selectedHandle.imageUrl,
        asset_url: selectedHandle.asset_url,
        normalizedAssetUrl: normalizeHandleAssetUrl(selectedHandle)
      })
    );
  }

  logInfo("generation.prompt", {
    door_context: getDoorContextForPrompt(doorContext),
    selected_handle: selectedHandle || null,
    selected_handle_asset: normalizeHandleAssetUrl(selectedHandle),
    selected_handle_public_url: publicHandleAssetUrl(selectedHandle),
    selected_handle_reference_image: selectedHandleReferenceImage,
    reference_image_count: selectedHandleReferenceImage ? 1 : 0,
    prompt
  });

  console.log(`Processing handle: ${selectedHandle.name || selectedHandle.id}`);
  const result = await openRouter.callImageGenerationModel(image.path, prompt, {
    mimeType: image.mimetype,
    referenceImages: selectedHandleReferenceImage ? [selectedHandleReferenceImage] : [],
    temperature: 0
  });

  const imageUrl = extractGeneratedImage(result);

  if (!imageUrl) {
    console.error("OpenRouter raw response:", JSON.stringify(result?.data ?? result, null, 2));
    throw new AppError(
      "The image generation model did not return a generated image.",
      502,
      "OpenRouter returned a successful response without an image URL or base64 payload."
    );
  }

  return {
    imageUrl,
    model: result?.model || IMAGE_GENERATION_MODEL,
    prompt,
    output_image_url: imageUrl
  };
}
