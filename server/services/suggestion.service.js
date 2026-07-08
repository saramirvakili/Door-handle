import { logInfo, logWarn } from "../utils/logger.js";
import { createOpenRouterClient } from "./openrouter.service.js";
import { getProductById, listProducts } from "./product.service.js";

const HANDLE_SUGGESTION_MODEL = "openai/gpt-4o";

function parseSuggestionContent(result) {
  const content = result?.choices?.[0]?.message?.content;
  if (!content) return null;
  if (typeof content === "object") return content;

  try {
    return JSON.parse(content);
  } catch {
    console.error("OpenRouter handle suggestions raw response:", content);
    return null;
  }
}

function normalizeCatalogId(value) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/^handle[_-]/, "");
  const withoutLeadingZeros = cleaned.replace(/^0+(?=\d)/, "");
  return withoutLeadingZeros || cleaned;
}

function resolveCatalogHandle(suggestion) {
  const suggestedId = normalizeCatalogId(suggestion?.id);
  const byId = suggestedId ? getProductById(suggestedId) : null;
  if (byId) return byId;

  logWarn("suggestions.unresolved_catalog_handle", {
    suggestedId: suggestion?.id,
    suggestedImageUrl: suggestion?.imageUrl
  });

  return null;
}

function normalizeSuggestion(suggestion, index, catalog) {
  const handle = resolveCatalogHandle(suggestion);
  if (!handle?.id || !handle?.imageUrl) return null;

  const resolved = {
    ...handle,
    id: String(handle.id),
    imageUrl: String(handle.imageUrl),
    name: String(handle.name || `Handle ${handle.id}`),
    style: String(handle?.style || suggestion?.style || "modern"),
    color: String(handle?.color || suggestion?.color || handle?.finish || "chrome"),
    material: String(handle?.material || suggestion?.material || "steel"),
    compatibility: String(handle?.compatibility || suggestion?.compatibility || "wood"),
    finish: String(handle?.finish || handle?.color || suggestion?.finish || "chrome"),
    isSmartHandle: handle?.isSmartHandle === true,
    side: handle?.isSmartHandle ? "right" : handle?.side,
    position: handle?.isSmartHandle ? "exterior" : handle?.position,
    description: String(
      suggestion?.description ||
        handle?.description ||
        "Catalog handle matched to the analyzed door."
    ),
    score: Number.isFinite(Number(suggestion?.score)) ? Number(suggestion.score) : 0,
    imageCacheKey: String(handle?.id || suggestion?.id || index)
  };

  logInfo("suggestions.return_handle", {
    id: resolved.id,
    imageUrl: resolved.imageUrl,
    style: resolved.style,
    color: resolved.color,
    material: resolved.material,
    side: resolved.side,
    position: resolved.position,
    isSmartHandle: resolved.isSmartHandle
  });

  return resolved;
}

function normalizeSuggestions(value, catalog) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 5)
    .map((suggestion, index) => normalizeSuggestion(suggestion, index, catalog))
    .filter(Boolean);
}

export async function suggestHandles(detectionResult) {
  const catalog = listProducts();
  const handleCatalog = catalog.map((handle) => ({
    id: String(handle.id),
    imageUrl: handle.imageUrl,
    name: handle.name,
    style: handle.style,
    color: handle.color,
    material: handle.material,
    compatibility: handle.compatibility,
    finish: handle.finish,
    isSmartHandle: handle.isSmartHandle,
    side: handle.side,
    position: handle.position,
    description: handle.description
  }));
  const door = detectionResult?.door || {};
  const recommendedHandleStyles = Array.isArray(detectionResult?.recommended_handle_styles)
    ? detectionResult.recommended_handle_styles
    : [];
  const recommendedFinishes = Array.isArray(detectionResult?.recommended_finishes)
    ? detectionResult.recommended_finishes
    : [];
  const openRouter = createOpenRouterClient();
  const result = await openRouter.callTextModel(
    {
      system: `You are a precise real-world interior door hardware catalog assistant.

Return strict JSON only. Suggest 3 to 5 compatible handle options only from handle_catalog.
Every suggestion must include an id copied exactly from handle_catalog.
Do not invent ids, image paths, or external URLs.

Compatibility rules:
- Classic carved wooden doors: prefer classic, neoclassical, gold, bronze, brass, or chrome options.
- Minimal modern doors: prefer minimal or modern black, chrome, silver, steel, or aluminum options.
- Glass doors: prefer handles whose compatibility is glass.
- Metal doors: prefer handles whose compatibility is metal.
- If uncertain, choose conservative catalog-compatible options.

Return ONLY this JSON shape:
{
  "suggestions": [
    {
      "id": "1",
      "name": "short display name",
      "description": "short compatibility reason",
      "score": 0.95
    }
  ]
}`,
      user: `Door analysis and active handle catalog:
${JSON.stringify(
  {
    door,
    recommended_handle_styles: recommendedHandleStyles,
    recommended_finishes: recommendedFinishes,
    handle_catalog: handleCatalog,
    reasoning: detectionResult?.reasoning || ""
  },
  null,
  2
)}`
    },
    {
      model: HANDLE_SUGGESTION_MODEL,
      maxTokens: 900,
      temperature: 0.2,
      responseFormat: { type: "json_object" }
    }
  );

  const parsed = parseSuggestionContent(result);
  return {
    suggestions: normalizeSuggestions(parsed?.suggestions, catalog)
  };
}
