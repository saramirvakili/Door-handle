export const VISION_MODEL = process.env.VISION_MODEL || "openai/gpt-4o";
export const IMAGE_GENERATION_MODEL = "google/gemini-3.1-flash-image-preview";

const maxOpenRouterImageBytes = 5 * 1024 * 1024;
const configuredMaxImageBytes = Number(process.env.MAX_IMAGE_BYTES || maxOpenRouterImageBytes);
const uploadMaxImageBytes = Number.isFinite(configuredMaxImageBytes)
  ? configuredMaxImageBytes
  : maxOpenRouterImageBytes;

export const IMAGE_LIMITS = {
  maxBytes: Math.min(uploadMaxImageBytes, maxOpenRouterImageBytes),
  allowedMimeTypes: new Set(["image/jpeg", "image/png", "image/webp"])
};
