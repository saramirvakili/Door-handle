import { analyzeDoorImage, errorResponse } from "../_ai.js";
import { handleOptions, jsonResponse } from "../_shared.js";

export function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  try {
    return jsonResponse(await analyzeDoorImage(context));
  } catch (error) {
    return errorResponse(error);
  }
}
