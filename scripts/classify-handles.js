import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VISION_MODEL } from "../server/config/model.js";
import { validateEnv } from "../server/config/env.js";
import { createOpenRouterClient } from "../server/services/openrouter.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const handlesDir = path.join(projectRoot, "public", "handles");
const outputPath = path.join(projectRoot, "server", "data", "handles.json");
const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const fallbackMetadata = {
  name: "Unknown Door Handle",
  style: "unknown",
  design: "unknown",
  material: "unknown",
  finish: "unknown",
  color: "unknown",
  shape: "unknown",
  recommendedDoorStyles: [],
  shortDescription: "Door handle metadata could not be classified."
};

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

function getHandleId(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  return `handle_${baseName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`;
}

function parseJsonContent(result, fileName) {
  const content = result?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model returned empty content.");
  if (typeof content === "object") return content;

  try {
    return JSON.parse(content);
  } catch {
    console.error(`Failed to parse JSON for ${fileName}. Raw response:`);
    console.error(content);
    throw new Error("Model returned invalid JSON.");
  }
}

function getText(value, fallback = "unknown") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeMetadata(metadata, fileName) {
  const recommendedDoorStyles = Array.isArray(metadata?.recommendedDoorStyles)
    ? metadata.recommendedDoorStyles.map((style) => getText(style)).filter(Boolean)
    : [];

  return {
    id: getHandleId(fileName),
    imageUrl: `/handles/${fileName}`,
    name: getText(metadata?.name, fallbackMetadata.name),
    style: getText(metadata?.style),
    design: getText(metadata?.design),
    material: getText(metadata?.material),
    finish: getText(metadata?.finish),
    color: getText(metadata?.color),
    shape: getText(metadata?.shape),
    recommendedDoorStyles,
    shortDescription: getText(metadata?.shortDescription, fallbackMetadata.shortDescription)
  };
}

async function classifyHandle(openRouter, fileName) {
  const imagePath = path.join(handlesDir, fileName);
  const result = await openRouter.callVisionModel(
    imagePath,
    {
      system: "You are a product cataloging assistant for door handles.",
      user: `Analyze the handle shown in the image and return ONLY valid JSON.
If unsure, use unknown.

Return this exact structure:
{
  "name": "short product-like name",
  "style": "lever | knob | pull | ring | unknown",
  "design": "modern | classic | minimal | luxury | industrial | vintage | unknown",
  "material": "metal | brass | steel | aluminum | wood | mixed | unknown",
  "finish": "matte black | chrome | brushed nickel | polished brass | bronze | silver | gold | white | black | unknown",
  "color": "black | silver | gold | brass | bronze | white | brown | mixed | unknown",
  "shape": "straight | curved | rounded | geometric | ornate | simple | unknown",
  "recommendedDoorStyles": ["modern", "classic"],
  "shortDescription": "one short sentence"
}`
    },
    {
      mimeType: getMimeType(imagePath),
      model: VISION_MODEL,
      temperature: 0,
      maxTokens: 500,
      responseFormat: { type: "json_object" }
    }
  );

  return normalizeMetadata(parseJsonContent(result, fileName), fileName);
}

async function main() {
  validateEnv();

  const entries = await fs.readdir(handlesDir, { withFileTypes: true });
  const imageFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => allowedExtensions.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const openRouter = createOpenRouterClient();
  const catalog = [];
  const failures = [];

  for (const fileName of imageFiles) {
    try {
      console.log(`Classifying ${fileName}...`);
      const metadata = await classifyHandle(openRouter, fileName);
      catalog.push(metadata);
      console.log(`Succeeded: ${fileName}`);
    } catch (error) {
      failures.push({ fileName, message: error?.message || "Unknown error" });
      console.error(`Failed: ${fileName} - ${error?.message || "Unknown error"}`);
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  console.log("");
  console.log("Handle classification summary");
  console.log(`Processed: ${imageFiles.length}`);
  console.log(`Succeeded: ${catalog.length}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log("Failed images:");
    for (const failure of failures) {
      console.log(`- ${failure.fileName}: ${failure.message}`);
    }
  }

  console.log(`Output: ${path.relative(projectRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(`Classification script failed: ${error?.message || "Unknown error"}`);
  process.exit(1);
});
