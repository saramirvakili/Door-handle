import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";
function stableSuggestionId(suggestion) {
  const explicitId = suggestion?.id;
  if (explicitId !== undefined && explicitId !== null) return String(explicitId).trim();
  if (suggestion?.imageUrl) return String(suggestion.imageUrl).trim();
  if (suggestion?.name) return String(suggestion.name).trim().toLowerCase().replace(/\s+/g, "-");
  return "";
}

function withCacheBuster(url, cacheKey) {
  if (!url || !cacheKey || url.startsWith("data:")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(cacheKey)}`;
}

function normalizeSuggestion(suggestion) {
  const id = stableSuggestionId(suggestion);
  const imageUrl = suggestion?.imageUrl || "";
  const isSmartHandle = suggestion?.isSmartHandle === true;
  if (id && imageUrl) {
    console.log("[suggestion:candidate]", { id, imageUrl, side: isSmartHandle ? "right" : suggestion?.side });
  }

  return {
    ...suggestion,
    id,
    imageUrl,
    isSmartHandle,
    side: isSmartHandle ? "right" : suggestion?.side,
    position: isSmartHandle ? "exterior" : suggestion?.position
  };
}

function selectedId(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function sameSuggestionId(left, right) {
  return selectedId(left) === selectedId(right);
}

function stableSuggestionKey(suggestion, index) {
  if (suggestion?.id) return `handle-${suggestion.id}`;
  if (suggestion?.imageUrl) return suggestion.imageUrl;
  return `suggestion-${index + 1}`;
}

function absoluteUrl(url) {
  if (!url) return "";
  return url.startsWith("http") || url.startsWith("data:") ? url : `${API_BASE}${url}`;
}

function publicAssetUrl(url) {
  if (!url) return "";
  if (url.startsWith("http") || url.startsWith("data:") || url.startsWith("/")) return url;
  return `/${url}`;
}

function suggestionImageSrc(suggestion) {
  return withCacheBuster(publicAssetUrl(suggestion?.imageUrl), suggestion?.imageCacheKey);
}

function generatedImageSrc(result) {
  if (!result) return "";
  if (result.imageUrl) return absoluteUrl(result.imageUrl);
  if (result.output_image_url) return absoluteUrl(result.output_image_url);
  if (result.output_image_base64?.startsWith("data:")) return result.output_image_base64;
  if (result.output_image_base64) return `data:image/png;base64,${result.output_image_base64}`;
  return "";
}

function readable(value, fallback = "نامشخص") {
  if (!value) return fallback;

  const labels = {
    modern: "مدرن",
    classic: "کلاسیک",
    traditional: "کلاسیک",
    contemporary: "معاصر",
    industrial: "صنعتی",
    minimalist: "مینیمال",
    minimal: "مینیمال",
    rustic: "روستیک",
    metal: "فلز",
    brass: "برنج",
    steel: "استیل",
    aluminum: "آلومینیوم",
    wood: "چوب",
    mixed: "ترکیبی",
    unknown: "نامشخص"
  };

  const normalized = String(value).trim();
  return labels[normalized.toLowerCase()] || normalized;
}

function getCustomerAnalysis(analysis, selectedSuggestion) {
  const metadata = analysis?.handle_metadata || {};
  const doorContext = analysis?.door_context || {};
  const doorStyle = readable(doorContext.style_classification, "سبک در قابل بررسی");
  const handleMaterial = readable(selectedSuggestion?.material || metadata.material, "متریال قابل بررسی");
  const handleFinish = readable(selectedSuggestion?.finish, "رنگ و پرداخت پیشنهادی");
  const productName = selectedSuggestion?.name || "برای انتخاب دقیق‌تر، پیشنهادهای هوشمند را دریافت کنید.";

  return {
    doorType: doorContext.description || readable(analysis?.doorType || metadata.door_type, "در موجود در تصویر"),
    style: doorStyle,
    productName,
    colorMaterial: selectedSuggestion ? `${handleFinish} با متریال ${handleMaterial}` : handleMaterial,
    summary: selectedSuggestion
      ? `این گزینه با در ${doorStyle} و پرداخت ${handleFinish} برای ظاهر در شما هماهنگ است.`
      : "پس از تحلیل تصویر، می‌توانید پیشنهادهای هوشمند را دریافت کنید تا چند دستگیره هماهنگ با ظاهر در نمایش داده شود."
  };
}

function App() {
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [processed, setProcessed] = useState(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsStatus, setSuggestionsStatus] = useState("idle");
  const [suggestionsError, setSuggestionsError] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  const selectedSuggestion = useMemo(
    () => suggestions.find((suggestion) => sameSuggestionId(suggestion.id, selectedSuggestionId)) || null,
    [selectedSuggestionId, suggestions]
  );
  const processedMatchesSelection =
    Boolean(processed) && sameSuggestionId(processed.selected_handle?.id, selectedSuggestionId);
  const customerAnalysis = getCustomerAnalysis(analysis, selectedSuggestion);

  function getHandleStyle() {
    return [selectedSuggestion?.style, selectedSuggestion?.finish]
      .filter(Boolean)
      .join(" ")
      .trim() || "دستگیره فلزی مدرن";
  }

  async function generate(analysisPayload = analysis) {
    if (!file || !analysisPayload) return;
    if (!selectedSuggestion?.id || !selectedSuggestion?.imageUrl) {
      throw new Error("Select an available handle before generating the preview.");
    }
    setStatus("generating");
    setError("");

    const body = new FormData();
    body.append("image", file);
    body.append("handle_metadata", JSON.stringify(analysisPayload.handle_metadata));
    body.append("door_context", JSON.stringify(analysisPayload.door_context || null));
    body.append("handle_style", getHandleStyle());
    body.append(
      "handle_material",
      selectedSuggestion?.material || analysisPayload.handle_metadata?.material || "فلز"
    );
    body.append("handle_product", selectedSuggestion?.name || "دستگیره پیشنهادی");

    if (selectedSuggestion) {
      body.append("selected_handle", JSON.stringify(normalizeSuggestion(selectedSuggestion)));
    }

    console.log("[generate:request]", {
      selectedHandleId: selectedSuggestion?.id || null,
      selectedHandleImageUrl: selectedSuggestion?.imageUrl || null,
      selectedHandleAssetUrl: selectedSuggestion?.asset_url || null,
      selectedHandleSide: selectedSuggestion?.side || null,
      selectedHandlePosition: selectedSuggestion?.position || null,
      selectedHandle: selectedSuggestion || null,
      handleCoords: analysisPayload.handle_metadata?.handle_coords || null
    });

    const response = await fetch(`${API_BASE}/api/generate`, { method: "POST", body });
    const payload = await response.json();
    console.log("[generate:response]", {
      ok: response.ok,
      selectedHandleId: payload?.selected_handle?.id || null,
      selectedHandleImageUrl: payload?.selected_handle?.imageUrl || null,
      outputImageUrl: payload?.imageUrl || payload?.output_image_url || null,
      payload
    });
    if (!response.ok) throw new Error(payload.message || "ساخت تصویر ناموفق بود.");
    setProcessed(payload);
    setStatus("generated");
  }

  async function analyze() {
    if (!file) return;
    setStatus("analyzing");
    setError("");
    setProcessed(null);

    const body = new FormData();
    body.append("image", file);

    const response = await fetch(`${API_BASE}/api/analyze`, { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "تحلیل تصویر ناموفق بود.");
    setAnalysis(payload);
    setStatus("analyzed");
  }

  async function loadSuggestions() {
    if (!analysis || suggestionsStatus === "loading") return;
    setSuggestionsStatus("loading");
    setSuggestionsError("");

    try {
      const response = await fetch(`${API_BASE}/api/suggest-handles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analysis)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "دریافت پیشنهادها ناموفق بود.");
      const normalizedSuggestions = Array.isArray(payload.suggestions)
        ? payload.suggestions.map(normalizeSuggestion).filter((suggestion) => suggestion.id && suggestion.imageUrl)
        : [];
      console.log("[suggestions:loaded]", normalizedSuggestions.map(({ id, imageUrl }) => ({ id, imageUrl })));
      setSuggestions(normalizedSuggestions);
      setSelectedSuggestionId((currentId) =>
        normalizedSuggestions.some((suggestion) => sameSuggestionId(suggestion.id, currentId)) ? currentId : ""
      );
      setSuggestionsStatus("loaded");
    } catch {
      setSuggestions([]);
      setSuggestionsStatus("error");
      setSuggestionsError("پیشنهادهای هوشمند فعلاً در دسترس نیست.");
    }
  }

  async function run(step) {
    try {
      await step();
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  function handleSuggestionImageError(event) {
    event.currentTarget.closest(".suggestion-card")?.setAttribute("hidden", "true");
  }

  return (
    <main className="app-shell">
      <section className="workbench">
        <div className="toolbar">
          <div>
            <p className="eyebrow">فروشگاه آقای اردیان</p>
            <h1>انتخاب هوشمند دستگیره در</h1>
          </div>
          <label className="upload-button">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setAnalysis(null);
                setProcessed(null);
                setSuggestions([]);
                setSelectedSuggestionId("");
                setSuggestionsError("");
                setSuggestionsStatus("idle");
                setError("");
              }}
            />
            انتخاب تصویر
          </label>
        </div>

        <div className="content-grid">
          <div className="preview-panel">
            {processedMatchesSelection ? (
              <ReactCompareSlider
                itemOne={<ReactCompareSliderImage src={previewUrl} alt="تصویر اصلی در" />}
                itemTwo={
                  <ReactCompareSliderImage
                    src={generatedImageSrc(processed)}
                    alt="پیش‌نمایش دستگیره جدید روی در"
                  />
                }
              />
            ) : previewUrl ? (
              <img src={previewUrl} alt="تصویر انتخاب‌شده از در" />
            ) : (
              <div className="empty-state">برای شروع، تصویر در را بارگذاری کنید.</div>
            )}
          </div>

          <aside className="side-panel">
            <div className="suggestion-section">
              <h2>پیشنهادهای هوشمند</h2>
              <button
                type="button"
                disabled={!analysis || suggestionsStatus === "loading"}
                onClick={loadSuggestions}
              >
                {suggestionsStatus === "loading" ? "در حال دریافت..." : "دریافت پیشنهادها"}
              </button>

              {suggestionsError && <p className="suggestions-message">{suggestionsError}</p>}

              {suggestions.length > 0 && (
                <div className="suggestion-grid">
                  {suggestions.map((suggestion, index) => (
                    <button
                      type="button"
                      key={stableSuggestionKey(suggestion, index)}
                      className={`suggestion-card ${
                        sameSuggestionId(suggestion.id, selectedSuggestionId) ? "selected" : ""
                      }`}
                      onClick={() => {
                        console.log("[suggestion:selected]", {
                          id: suggestion.id,
                          imageUrl: suggestion.imageUrl,
                          side: suggestion.side,
                          position: suggestion.position,
                          isSmartHandle: suggestion.isSmartHandle
                        });
                        setSelectedSuggestionId(suggestion.id);
                        setProcessed(null);
                      }}
                      aria-pressed={sameSuggestionId(suggestion.id, selectedSuggestionId)}
                    >
                      <span className="suggestion-image-frame">
                        <img
                          key={`${suggestion.id}-${suggestion.imageUrl}-${suggestion.imageCacheKey || ""}`}
                          src={suggestionImageSrc(suggestion)}
                          alt={`تصویر ${suggestion.name || "دستگیره پیشنهادی"}`}
                          onError={handleSuggestionImageError}
                        />
                      </span>
                      <span className="suggestion-copy">
                        <strong>{suggestion.name || "دستگیره پیشنهادی"}</strong>
                        <span>{suggestion.finish || "پرداخت پیشنهادی"}</span>
                        <p>{suggestion.description || "گزینه‌ای هماهنگ با ظاهر در شما."}</p>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              disabled={!file || status === "analyzing" || status === "generating"}
              onClick={() => run(analyze)}
            >
              {status === "analyzing" ? "در حال تحلیل..." : "تحلیل تصویر"}
            </button>
            <button
              disabled={!analysis || !selectedSuggestion || status === "generating"}
              className="primary"
              onClick={() => run(() => generate())}
            >
              {status === "generating" ? "در حال ساخت..." : "ساخت پیش‌نمایش"}
            </button>

            {error && <p className="error">{error}</p>}

            {analysis && (
              <div className="metadata">
                <h2>نتیجه تحلیل</h2>
                <dl>
                  <dt>نوع در</dt>
                  <dd>{customerAnalysis.doorType}</dd>
                  <dt>سبک کلی</dt>
                  <dd>{customerAnalysis.style}</dd>
                  <dt>پیشنهاد دستگیره</dt>
                  <dd>{customerAnalysis.productName}</dd>
                  <dt>رنگ و متریال پیشنهادی</dt>
                  <dd>{customerAnalysis.colorMaterial}</dd>
                  <dt>جمع‌بندی</dt>
                  <dd>{customerAnalysis.summary}</dd>
                </dl>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
