import { errorResponse, generateReplacement } from "../_ai.js";
import { handleOptions, jsonResponse } from "../_shared.js";

export function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  try {
    return jsonResponse(await generateReplacement(context));
  } catch (error) {
    return errorResponse(error);
  }
}
