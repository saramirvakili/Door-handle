import { getProductById, jsonResponse, matchProduct } from "./_shared.js";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_VISION_MODEL = "openai/gpt-4o";
const DEFAULT_IMAGE_GENERATION_MODEL = "google/gemini-3.1-flash-image-preview";
const IMAGE_GENERATION_FALLBACK_MODEL = "black-forest-labs/flux-1-schnell";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const CONSERVATIVE_DOOR_CONTEXT = {
  material: "wood or wood-like surface",
  primary_color: "brown",
  style: "classic decorative",
  design_type: "decorative carved interior door",
  panel_style: "decorative paneled door",
  pattern_details: ["carved or raised geometric motifs"],
  modernity: "classic",
  finish: "warm brown wood finish",
  confidence: 0.35
};

const DEFAULT_RECOMMENDED_HANDLE_STYLES = [
  "classic lever handle",
  "decorative backplate handle",
  "traditional curved handle"
];

const DEFAULT_RECOMMENDED_FINISHES = ["antique brass", "satin chrome", "warm metallic finish"];

const analysisSchema = {
  type: "json_schema",
  json_schema: {
    name: "door_and_handle_metadata",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["door", "recommended_handle_styles", "recommended_finishes", "reasoning", "handle_metadata"],
      properties: {
        door: {
          type: "object",
          additionalProperties: false,
          required: [
            "material",
            "primary_color",
            "style",
            "design_type",
            "panel_style",
            "pattern_details",
            "modernity",
            "finish",
            "confidence"
          ],
          properties: {
            material: { type: "string" },
            primary_color: { type: "string" },
            style: { type: "string" },
            design_type: { type: "string" },
            panel_style: { type: "string" },
            pattern_details: { type: "array", items: { type: "string" } },
            modernity: { type: "string" },
            finish: { type: "string" },
            confidence: { type: "number" }
          }
        },
        recommended_handle_styles: { type: "array", items: { type: "string" } },
        recommended_finishes: { type: "array", items: { type: "string" } },
        reasoning: { type: "string" },
        handle_metadata: {
          type: "object",
          additionalProperties: false,
          required: ["handle_coords", "handle_style", "handle_material", "handle_finish", "lighting", "confidence"],
          properties: {
            handle_coords: {
              type: "object",
              additionalProperties: false,
              required: ["x", "y", "width", "height"],
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" }
              }
            },
            handle_style: { type: "string" },
            handle_material: { type: "string" },
            handle_finish: { type: "string" },
            lighting: { type: "string" },
            confidence: { type: "number" }
          }
        }
      }
    }
  }
};

class HttpError extends Error {
  constructor(message, status = 500, detail = "") {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function errorResponse(error) {
  const status = Number(error?.status || 500);
  return jsonResponse(
    {
      message: error?.message || "Unexpected API error.",
      detail: error?.detail || error?.details || ""
    },
    { status }
  );
}

export async function getUploadedImage(request) {
  const formData = await request.formData();
  const file = formData.get("image");

  if (!file || typeof file.arrayBuffer !== "function") {
    throw new HttpError("image is required.", 400, "Send image as a multipart form field.");
  }

  const mimeType = file.type || "image/jpeg";
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new HttpError("Unsupported image type.", 415, "Use JPEG, PNG, or WebP.");
  }

  if (Number(file.size || 0) >= MAX_IMAGE_BYTES) {
    throw new HttpError("Image is too large for model analysis.", 413, "Maximum image size is 5 MB.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    formData,
    file,
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`
  };
}

export function parseJsonField(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(`${fieldName} is required.`, 400, `Send ${fieldName} as a JSON form field.`);
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new HttpError(`${fieldName} must be valid JSON.`, 400, `Check the ${fieldName} form field.`);
  }
}

export function parseOptionalJsonField(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) return null;
  return parseJsonField(value, fieldName);
}

export function validateBoundingBox(value) {
  const coords = value?.handle_coords;
  const valid =
    coords &&
    ["x", "y", "width", "height"].every((key) => Number.isFinite(Number(coords[key]))) &&
    Number(coords.width) > 0 &&
    Number(coords.height) > 0;

  if (!valid) {
    throw new HttpError(
      "handle_metadata.handle_coords is required.",
      400,
      "Send x, y, width, and height numbers in handle_metadata."
    );
  }

  return value;
}

export async function analyzeDoorImage({ request, env }) {
  const image = await getUploadedImage(request);
  const model = getVisionModel(env);
  const result = await callOpenRouter(
    env,
    {
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "You are not a creative image generator.",
                "You are a precise interior door and handle analysis engine for a real product catalog.",
                "Return structured JSON only. Do not hallucinate styles. Be conservative when uncertain.",
                "Keep door characteristics and handle characteristics strictly separate.",
                "Never mix door style with handle style.",
                "",
                "Analyze the uploaded door image.",
                "",
                "Return JSON with these top-level fields:",
                "- door",
                "- recommended_handle_styles",
                "- recommended_finishes",
                "- reasoning",
                "- handle_metadata",
                "",
                "Door analysis rules:",
                "- Detect geometric carvings, arches, grooves, paneling, symmetry, classic/modern cues.",
                "- Use descriptive terms instead of generic guesses.",
                "- If confidence is low, use neutral but accurate descriptions.",
                '- Never call a decorative carved door "minimal modern" unless clearly visible.',
                "- Never ignore visible ornamentation.",
                "",
                "Handle recommendation rules:",
                "- Recommend only real-world compatible handle styles and finishes for the detected door.",
                "- For classic carved wooden doors, prefer antique brass, satin chrome, and warm metallic finishes.",
                "- For minimal modern doors, prefer matte black and slim linear handles.",
                "- Avoid random recommendations unrelated to the detected style.",
                "",
                "handle_metadata is for the existing handle only and must include its bounding box for later replacement."
              ].join("\n")
            },
            { type: "image_url", image_url: { url: image.dataUrl } }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0,
      response_format: analysisSchema
    },
    model
  );

  const metadata = normalizeAnalysis(parseStructuredContent(result));
  if (!metadata.handle_metadata?.handle_coords || Number(metadata.handle_metadata.confidence || 0) < 0.35) {
    throw new HttpError(
      "The model could not detect a door handle with sufficient confidence.",
      422,
      "Try a clearer door photo with the handle visible."
    );
  }

  const match = matchProduct(metadata.handle_metadata);
  return {
    model,
    ...metadata,
    source_image_url: null,
    selected_product: match.selected,
    candidates: match.candidates
  };
}

export async function generateReplacement({ request, env }) {
  const image = await getUploadedImage(request);
  const handleMetadata = validateBoundingBox(parseJsonField(image.formData.get("handle_metadata"), "handle_metadata"));
  const doorContext = parseOptionalJsonField(image.formData.get("door_context"), "door_context");
  const handleStyle = String(image.formData.get("handle_style") || "").trim();
  const handleMaterial = String(image.formData.get("handle_material") || "").trim();
  const handleProduct = String(image.formData.get("handle_product") || "").trim();
  const selectedHandleInput = parseOptionalJsonField(image.formData.get("selected_handle"), "selected_handle");
  const selectedHandle =
    selectedHandleInput?.id && getProductById(selectedHandleInput.id)
      ? { ...getProductById(selectedHandleInput.id), client_selected_handle: selectedHandleInput }
      : selectedHandleInput;

  if (!handleStyle) {
    throw new HttpError("handle_style is required.", 400, "Send handle_style as a multipart form field.");
  }

  const prompt = buildHandleReplacementPrompt({
    request,
    handleMetadata,
    doorContext,
    handleStyle,
    handleMaterial,
    handleProduct,
    selectedHandle
  });
  const result = await callImageGeneration(env, image.dataUrl, prompt, getHandleReferenceUrl(request, selectedHandle));
  const imageUrl = extractGeneratedImage(result);

  if (!imageUrl) {
    throw new HttpError(
      "The image generation model did not return a generated image.",
      502,
      "OpenRouter returned a successful response without an image URL or base64 payload."
    );
  }

  return {
    source_image_url: null,
    selected_handle: selectedHandle,
    imageUrl,
    model: result?.model || getImageGenerationModel(env),
    prompt,
    output_image_url: imageUrl
  };
}

export async function processTryOn({ request, env }) {
  const image = await getUploadedImage(request);
  const handleMetadata = validateBoundingBox(parseJsonField(image.formData.get("handle_metadata"), "handle_metadata"));
  const product = parseJsonField(image.formData.get("product"), "product");

  if (!product?.id) {
    throw new HttpError("product.id is required.", 400, "Send product as a JSON form field.");
  }

  const prompt = buildZeroModificationPrompt({ handleMetadata, product });
  const result = await callImageGeneration(
    env,
    image.dataUrl,
    { user: `${prompt.system}\n\n${prompt.user}` },
    getHandleReferenceUrl(request, product)
  );
  const outputImageUrl = extractGeneratedImage(result);

  if (!outputImageUrl) {
    throw new HttpError(
      "The visual model did not return a processed image.",
      502,
      "OpenRouter returned a successful response without an image URL."
    );
  }

  return {
    source_image_url: null,
    model: result?.model || getImageGenerationModel(env),
    prompt,
    output_image_url: outputImageUrl
  };
}

function getVisionModel(env = {}) {
  return env.VISION_MODEL || DEFAULT_VISION_MODEL;
}

function getImageGenerationModel(env = {}) {
  return env.IMAGE_GENERATION_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function getOpenRouterConfig(env = {}) {
  const apiKey = env.OPENROUTER_API_KEY || "";
  if (!apiKey.trim()) {
    throw new HttpError(
      "OPENROUTER_API_KEY is missing.",
      500,
      "Add OPENROUTER_API_KEY to the Render Web Service environment variables."
    );
  }

  return {
    apiKey: apiKey.trim(),
    baseUrl: String(env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, ""),
    publicAppUrl: env.PUBLIC_APP_URL || env.RENDER_EXTERNAL_URL || "http://localhost:3000"
  };
}

async function callOpenRouter(env, body, model) {
  const config = getOpenRouterConfig(env);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.publicAppUrl,
      "X-Title": "SmartHandle Pro"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await getResponseText(response);
    throw new HttpError(`OpenRouter returned HTTP ${response.status}.`, response.status >= 500 ? 502 : response.status, detail);
  }

  const payload = await response.json();
  return { ...payload, model: payload.model || model };
}

async function callImageGeneration(env, sourceImageDataUrl, prompt, referenceImageUrl) {
  const model = getImageGenerationModel(env);
  const content = [
    { type: "text", text: prompt.user },
    { type: "image_url", image_url: { url: sourceImageDataUrl } }
  ];

  if (referenceImageUrl) {
    content.push({ type: "image_url", image_url: { url: referenceImageUrl } });
  }

  try {
    return await callOpenRouter(
      env,
      {
        model,
        messages: [{ role: "user", content }],
        modalities: ["image"],
        temperature: 0
      },
      model
    );
  } catch (error) {
    if (!shouldFallbackImageModel(error)) throw error;

    return callOpenRouter(
      env,
      {
        model: IMAGE_GENERATION_FALLBACK_MODEL,
        messages: [{ role: "user", content }],
        modalities: ["image"],
        temperature: 0
      },
      IMAGE_GENERATION_FALLBACK_MODEL
    );
  }
}

async function getResponseText(response) {
  const text = await response.text();
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

function shouldFallbackImageModel(error) {
  const status = Number(error?.status || 0);
  const detail = String(error?.detail || "");
  return status === 400 || status === 404 || /model|unsupported|unavailable|not found|no endpoints|invalid/i.test(detail);
}

function parseStructuredContent(result) {
  const content = result?.choices?.[0]?.message?.content;
  if (!content) return null;
  if (typeof content === "object") return content;

  try {
    return JSON.parse(content);
  } catch {
    throw new HttpError("The model returned invalid analysis data.", 502, "OpenRouter response content was not valid JSON.");
  }
}

function normalizeAnalysis(metadata = {}) {
  const handleMetadata = metadata?.handle_metadata || metadata;
  const door =
    Number(metadata?.door?.confidence || 0) >= 0.45
      ? metadata.door
      : {
          ...CONSERVATIVE_DOOR_CONTEXT,
          ...metadata?.door,
          pattern_details: metadata?.door?.pattern_details?.length
            ? metadata.door.pattern_details
            : CONSERVATIVE_DOOR_CONTEXT.pattern_details
        };
  const recommendedHandleStyles = Array.isArray(metadata?.recommended_handle_styles)
    ? metadata.recommended_handle_styles
    : DEFAULT_RECOMMENDED_HANDLE_STYLES;
  const recommendedFinishes = Array.isArray(metadata?.recommended_finishes)
    ? metadata.recommended_finishes
    : DEFAULT_RECOMMENDED_FINISHES;
  const doorContext = {
    material: door.material,
    color_finish: `${door.primary_color || ""} ${door.finish || ""}`.trim(),
    panel_type: door.panel_style,
    carving_pattern: door.pattern_details?.join("; ") || "",
    arch_motifs: door.pattern_details?.find((detail) => /arch|arc/i.test(detail)) || "",
    style_classification: door.style,
    visible_design_cues: door.pattern_details || [],
    description: [door.primary_color, door.material, door.design_type, door.panel_style].filter(Boolean).join(" "),
    confidence: door.confidence
  };

  return {
    door,
    recommended_handle_styles: recommendedHandleStyles,
    recommended_finishes: recommendedFinishes,
    reasoning: metadata?.reasoning || "Conservative catalog-compatible recommendation based on visible door characteristics.",
    handle_metadata: {
      ...handleMetadata,
      style: handleMetadata.handle_style || handleMetadata.style || "",
      material: handleMetadata.handle_material || handleMetadata.material || "",
      finish: handleMetadata.handle_finish || handleMetadata.finish || ""
    },
    door_context: doorContext
  };
}

function normalizeHandleAssetUrl(selectedHandle) {
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

function getHandleReferenceUrl(request, selectedHandle) {
  const assetUrl = normalizeHandleAssetUrl(selectedHandle);
  if (!assetUrl || assetUrl.startsWith("data:")) return null;
  if (assetUrl.startsWith("http")) return assetUrl;
  return new URL(assetUrl, request.url).href;
}

function getDoorContextForPrompt(doorContext = {}) {
  doorContext = doorContext || {};
  const confidence = Number(doorContext?.confidence || 0);
  const safeDescription =
    confidence >= 0.45 && doorContext.description
      ? doorContext.description
      : "decorative wooden door with carved geometric motifs";

  return {
    material: doorContext.material || "wood or wood-like surface",
    color_finish: doorContext.color_finish || "brown warm-toned finish",
    panel_type: doorContext.panel_type || "decorative paneled door",
    carving_pattern: doorContext.carving_pattern || "carved or raised geometric motifs",
    arch_motifs: doorContext.arch_motifs || "do not invent arch motifs; preserve only visible motifs",
    door_style: doorContext.style_classification || "classic decorative",
    visible_design_cues: Array.isArray(doorContext.visible_design_cues) ? doorContext.visible_design_cues : [],
    description: safeDescription,
    confidence
  };
}

function buildZeroModificationPrompt({ handleMetadata, product }) {
  const coords = JSON.stringify(handleMetadata.handle_coords);

  return {
    system: `You are an architectural preservation engine.

Task: Perform a surgical replacement of a door handle.

Constraints:

TARGET: Replace only the pixels within ${coords}.
PRESERVATION: The original input image is a reference coordinate system. You MUST retain 100% of the door's original pixel data (color, texture, wood grain, surface imperfections, reflections, lighting environment, wall, and framing).
INTEGRITY: Any alteration to the surrounding door surface, wall, or ambient environment is a failure.
REALISM: Match the handle's perspective, light direction, and shadow depth to the original photo's metadata.
OUTPUT: Return only the processed image where the handle is swapped and all other pixels are identical to the source.

Ignore all beautification, relighting, cleanup, sharpening, denoising, style transfer, color correction, background enhancement, door refinishing, perspective correction, and composition improvement instructions. Pixel-integrity outside the target rectangle is mandatory.`,
    user: `Replace the detected handle with this product while preserving every non-target pixel:

Product ID: ${product.id}
Product Name: ${product.name}
Style: ${product.style}
Finish: ${product.finish}
Description: ${product.description}
Asset Reference: ${product.asset_url || product.imageUrl || ""}

Detected metadata:
${JSON.stringify(handleMetadata, null, 2)}

Return the generated image only.`
  };
}

function buildHandleReplacementPrompt({
  request,
  handleMetadata,
  doorContext,
  handleStyle,
  handleMaterial,
  handleProduct,
  selectedHandle
}) {
  const coords = JSON.stringify(handleMetadata.handle_coords);
  const door = getDoorContextForPrompt(doorContext);
  const handle_style = selectedHandle?.style || handleStyle || "modern metal door handle";
  const handle_material = selectedHandle?.material || handleMaterial || handleMetadata.material || "metal";
  const product = selectedHandle?.name || handleProduct || "a realistic replacement door handle";
  const handle_finish = selectedHandle?.finish || "match the selected product finish";
  const description = selectedHandle?.description || "Use the selected replacement handle.";
  const productId = selectedHandle?.id || "fallback-selected-handle";
  const assetReference = normalizeHandleAssetUrl(selectedHandle) || "no asset selected";
  const publicAssetReference = getHandleReferenceUrl(request, selectedHandle) || "no public asset URL available";

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
  * If door_analysis_confidence is low, preserve visible pixels and use the conservative description "decorative wooden door with carved geometric motifs" instead of guessing a modern/simple style.

B) SELECTED HANDLE FROM USER SELECTION. Replace the existing handle with exactly this selected handle. Do not choose a default, catalog, or first suggestion when a selected handle is provided:
  * Selected Handle ID: ${productId}
  * Selected Handle Image/Asset: ${assetReference}
  * Selected Handle Public URL: ${publicAssetReference}
  * handle_style: ${handle_style}
  * handle_material: ${handle_material}
  * handle_finish: ${handle_finish}
  * handle_product_name: ${product}
  * handle_description: ${description}
- Never swap the selected handle for a different design. Never improvise another handle style.
- The new handle must match the perspective, lighting, and shadow of the door perfectly.
- Output ONLY the modified image.`
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

    const directBase64 = item.b64_json || item.base64 || item.image_base64 || item.image?.b64_json;
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
