import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "server", "data");
const catalogPath = path.join(dataDir, "catalog.json");
const handlesJsonPath = path.join(dataDir, "handles.json");
const productsJsonPath = path.join(dataDir, "products.json");
const frontendHandlesPath = path.join(projectRoot, "src", "data", "handles.js");

const allowed = {
  style: new Set(["modern", "classic", "neoclassical", "minimal"]),
  color: new Set(["gold", "silver", "black", "bronze", "chrome"]),
  material: new Set(["brass", "steel", "zamak", "aluminum"]),
  compatibility: new Set(["wood", "glass", "metal"])
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function assertAllowed(field, value, sourceId) {
  const normalized = normalizeText(value);
  if (!allowed[field].has(normalized)) {
    throw new Error(`Invalid ${field}="${value}" for catalog item id=${sourceId}`);
  }
  return normalized;
}

function normalizeCatalogItem(item) {
  const id = Number(item?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid catalog id: ${JSON.stringify(item?.id)}`);
  }

  const style = assertAllowed("style", item.style, id);
  const color = assertAllowed("color", item.color, id);
  const material = assertAllowed("material", item.material, id);
  const compatibility = assertAllowed("compatibility", item.compatibility, id);
  const filename = item.filename || `${id}.png`;

  return {
    id,
    filename,
    imageUrl: `/handles/${filename}`,
    style,
    color,
    material,
    compatibility,
    name: `Handle ${id}`,
    finish: color,
    description: `${style} ${color} ${material} handle compatible with ${compatibility} doors.`
  };
}

async function readCatalog() {
  const raw = await fs.readFile(catalogPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${path.relative(projectRoot, catalogPath)} must contain a JSON array.`);
  }

  const seen = new Set();
  return parsed
    .map(normalizeCatalogItem)
    .sort((a, b) => a.id - b.id)
    .map((item) => {
      if (seen.has(item.id)) throw new Error(`Duplicate catalog id=${item.id}`);
      seen.add(item.id);
      return item;
    });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFrontendModule(handles) {
  await fs.mkdir(path.dirname(frontendHandlesPath), { recursive: true });
  const moduleSource = `export const handles = ${JSON.stringify(handles, null, 2)};\n`;
  await fs.writeFile(frontendHandlesPath, moduleSource, "utf8");
}

async function main() {
  const handles = await readCatalog();

  await writeJson(handlesJsonPath, handles);
  await writeJson(productsJsonPath, handles);
  await writeFrontendModule(handles);

  console.log("Catalog sync complete");
  console.log(`Source: ${path.relative(projectRoot, catalogPath)}`);
  console.log(`Items: ${handles.length}`);
  console.log(`Updated: ${path.relative(projectRoot, handlesJsonPath)}`);
  console.log(`Updated: ${path.relative(projectRoot, productsJsonPath)}`);
  console.log(`Updated: ${path.relative(projectRoot, frontendHandlesPath)}`);
}

main().catch((error) => {
  console.error(`Catalog sync failed: ${error.message}`);
  process.exit(1);
});
