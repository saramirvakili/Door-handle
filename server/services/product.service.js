import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const catalogPath = path.join(dataDir, "catalog.json");
const handlesPath = path.join(dataDir, "handles.json");
const productsPath = path.join(dataDir, "products.json");

function loadJson(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadActiveProducts() {
  const handles = loadJson(handlesPath);
  if (handles.length) return handles;

  const catalog = loadJson(catalogPath);
  if (catalog.length) return catalog;

  return loadJson(productsPath);
}

function normalize(value = "") {
  return String(value || "").toLowerCase().trim();
}

function normalizeCatalogId(value) {
  const cleaned = normalize(value).replace(/^handle[_-]/, "");
  const withoutLeadingZeros = cleaned.replace(/^0+(?=\d)/, "");
  return withoutLeadingZeros || cleaned;
}

function getProductId(product) {
  return String(product.id || product.filename || "");
}

function productImageUrl(product) {
  if (product.imageUrl) return product.imageUrl;
  const assetUrl = String(product.asset_url || "");
  const legacyAssetMatch = assetUrl.match(/\/assets\/handles\/handle-(\d+)\.(png|jpe?g|webp)$/i);
  if (legacyAssetMatch) return `/handles/${Number(legacyAssetMatch[1])}.${legacyAssetMatch[2].toLowerCase()}`;
  if (product.asset_url) return product.asset_url;
  if (product.filename) return `/handles/${product.filename}`;
  if (Number.isInteger(Number(product.id))) return `/handles/${product.id}.png`;
  return "/handles/1.png";
}

function normalizeProduct(product) {
  const id = product.id;
  const style = product.style || "modern";
  const color = product.color || product.finish || "chrome";
  const material = product.material || "steel";
  const compatibility = product.compatibility || "wood";

  return {
    ...product,
    id,
    imageUrl: productImageUrl(product),
    style,
    color,
    material,
    compatibility,
    finish: product.finish || color,
    name: product.name || `Handle ${id}`,
    description:
      product.description ||
      `${style} ${color} ${material} handle compatible with ${compatibility} doors.`
  };
}

function scoreProduct(metadata, product) {
  const style = normalize(metadata.style || metadata.handle_style);
  const material = normalize(metadata.material || metadata.handle_material);
  const finish = normalize(product.finish || product.color);
  const productStyle = normalize(product.style);
  const compatibility = normalize(product.compatibility);
  const doorMaterial = normalize(metadata.door_material || metadata.material_hint);
  const description = normalize(product.description);

  let score = 0;
  if (style && productStyle.includes(style)) score += 60;
  if (style && style.includes(productStyle)) score += 45;
  if (material && finish.includes(material)) score += 35;
  if (material && normalize(product.material).includes(material)) score += 35;
  if (material && material.includes(finish)) score += 20;
  if (doorMaterial && compatibility.includes(doorMaterial)) score += 25;
  if (style && description.includes(style)) score += 10;

  return score;
}

export function listProducts() {
  return loadActiveProducts().map(normalizeProduct);
}

export function getProductById(id) {
  const exactId = String(id || "").trim();
  const normalizedId = normalizeCatalogId(id);
  const products = listProducts();
  return products.find((product) => String(product.id || "").trim() === exactId) ||
    products.find((product) => normalizeCatalogId(product.id) === normalizedId) ||
    null;
}

export function matchProduct(handleMetadata) {
  const products = listProducts();
  const ranked = products
    .map((product) => ({
      product,
      score: scoreProduct(handleMetadata, product)
    }))
    .sort((a, b) => b.score - a.score || getProductId(a.product).localeCompare(getProductId(b.product)));

  return {
    selected: ranked[0]?.product || null,
    candidates: ranked.slice(0, 5)
  };
}
