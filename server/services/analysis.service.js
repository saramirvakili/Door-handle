import { VISION_MODEL } from "../config/model.js";
import { createOpenRouterClient } from "./openrouter.service.js";
import { AppError } from "../utils/app-error.js";
import { logInfo } from "../utils/logger.js";

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
      required: [
        "door",
        "recommended_handle_styles",
        "recommended_finishes",
        "reasoning",
        "handle_metadata"
      ],
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
            pattern_details: {
              type: "array",
              items: { type: "string" }
            },
            modernity: { type: "string" },
            finish: { type: "string" },
            confidence: { type: "number" }
          }
        },
        recommended_handle_styles: {
          type: "array",
          items: { type: "string" }
        },
        recommended_finishes: {
          type: "array",
          items: { type: "string" }
        },
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

function parseStructuredContent(result) {
  const content = result?.choices?.[0]?.message?.content;
  if (!content) return null;
  if (typeof content === "object") return content;
  try {
    return JSON.parse(content);
  } catch {
    throw new AppError(
      "The model returned invalid analysis data.",
      502,
      "OpenRouter response content was not valid JSON."
    );
  }
}

function normalizeAnalysis(metadata) {
  const handleMetadata = metadata?.handle_metadata || metadata;
  const door =
    metadata?.door?.confidence >= 0.45
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
    arch_motifs: door.pattern_details?.find((detail) => /arch|arc|قوس/i.test(detail)) || "",
    style_classification: door.style,
    visible_design_cues: door.pattern_details || [],
    description: [door.primary_color, door.material, door.design_type, door.panel_style]
      .filter(Boolean)
      .join(" "),
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

export async function analyzeDoorHandle(image) {
  const openRouter = createOpenRouterClient();
  const result = await openRouter.callVisionModel(
    image.path,
    {
      system:
        `You are not a creative image generator.
You are a precise interior door and handle analysis engine for a real product catalog.
Return structured JSON only. Do not hallucinate styles. Be conservative when uncertain.
Keep door characteristics and handle characteristics strictly separate.
Never mix door style with handle style.`,
      user: `Analyze the uploaded door image.

Return JSON with these top-level fields:
- door
- recommended_handle_styles
- recommended_finishes
- reasoning
- handle_metadata

Door analysis rules:
- Detect geometric carvings, arches, grooves, paneling, symmetry, classic/modern cues.
- Use descriptive terms instead of generic guesses.
- If confidence is low, use neutral but accurate descriptions.
- Never call a decorative carved door "minimal modern" unless clearly visible.
- Never ignore visible ornamentation.

Handle recommendation rules:
- Recommend only real-world compatible handle styles and finishes for the detected door.
- For classic carved wooden doors, prefer antique brass, satin chrome, and warm metallic finishes.
- For minimal modern doors, prefer matte black and slim linear handles.
- Avoid random recommendations unrelated to the detected style.

handle_metadata is for the existing handle only and must include its bounding box for later replacement.`
    },
    {
      mimeType: image.mimetype,
      responseFormat: analysisSchema,
      temperature: 0
    }
  );

  const metadata = normalizeAnalysis(parseStructuredContent(result));
  if (!metadata.handle_metadata?.handle_coords || metadata.handle_metadata.confidence < 0.35) {
    throw new AppError(
      "The model could not detect a door handle with sufficient confidence.",
      422,
      "Try a clearer door photo with the handle visible."
    );
  }

  logInfo("analysis.structured", {
    door: metadata.door,
    recommended_handle_styles: metadata.recommended_handle_styles,
    recommended_finishes: metadata.recommended_finishes,
    reasoning: metadata.reasoning,
    door_context: metadata.door_context,
    handle_metadata: metadata.handle_metadata
  });

  return {
    model: VISION_MODEL,
    ...metadata
  };
}
