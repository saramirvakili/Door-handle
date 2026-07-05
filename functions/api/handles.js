import { handleOptions, jsonResponse, listProducts } from "../_shared.js";

export function onRequestOptions() {
  return handleOptions();
}

export function onRequestGet() {
  return jsonResponse({ handles: listProducts() });
}
