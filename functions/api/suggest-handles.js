import { handleOptions, jsonResponse, readJsonRequest, suggestFromCatalog } from "../_shared.js";

export function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost({ request }) {
  const body = await readJsonRequest(request);
  return jsonResponse(suggestFromCatalog(body));
}
