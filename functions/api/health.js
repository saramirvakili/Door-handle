import { handleOptions, jsonResponse } from "../_shared.js";

export function onRequestOptions() {
  return handleOptions();
}

export function onRequestGet() {
  return jsonResponse({
    ok: true,
    service: "smarthandle-pro-api",
    runtime: "cloudflare-pages-functions"
  });
}
