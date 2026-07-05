import { AppError } from "./app-error.js";

export function parseJsonField(value, fieldName) {
  if (!value) {
    throw new AppError(`${fieldName} is required.`, 400, `Send ${fieldName} as a JSON form field.`);
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(`${fieldName} must be valid JSON.`, 400, `Check the ${fieldName} form field.`);
  }
}

export function validateImageFile(file) {
  if (!file) {
    throw new AppError("Upload an image using the image form field.", 400, "Expected multipart field: image.");
  }
}

export function validateBoundingBox(handleMetadata) {
  const box = handleMetadata?.handle_coords;
  const fields = ["x", "y", "width", "height"];

  if (!box || typeof box !== "object") {
    throw new AppError(
      "handle_metadata.handle_coords is required.",
      400,
      "Send x, y, width, and height values."
    );
  }

  for (const field of fields) {
    if (!Number.isFinite(Number(box[field]))) {
      throw new AppError(
        `handle_metadata.handle_coords.${field} must be a number.`,
        400,
        "Bounding box values must be numeric."
      );
    }
  }

  if (Number(box.width) <= 0 || Number(box.height) <= 0) {
    throw new AppError(
      "Bounding box width and height must be greater than zero.",
      400,
      "Use positive width and height values."
    );
  }

  return {
    ...handleMetadata,
    handle_coords: {
      x: Number(box.x),
      y: Number(box.y),
      width: Number(box.width),
      height: Number(box.height)
    }
  };
}
