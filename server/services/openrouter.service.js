import fs from "node:fs/promises";
import { fetch, ProxyAgent } from "undici";
import { env } from "../config/env.js";
import { IMAGE_GENERATION_MODEL, IMAGE_LIMITS, VISION_MODEL } from "../config/model.js";
import { AppError } from "../utils/app-error.js";
import { logInfo, logWarn } from "../utils/logger.js";

const REQUEST_TIMEOUT_MS = 90_000;
const IMAGE_GENERATION_FALLBACK_MODEL = "black-forest-labs/flux-1-schnell";

function getDataUrl(mimeType, imageBase64) {
  return `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;
}

async function buildImageContent(imagePath, mimeType) {
  const imageStats = await validateImageForOpenRouter(imagePath);
  const imageBuffer = await fs.readFile(imagePath);
  const imageBase64 = imageBuffer.toString("base64");

  return {
    content: {
      type: "image_url",
      image_url: {
        url: getDataUrl(mimeType, imageBase64)
      }
    },
    stats: imageStats
  };
}

function getProxyUrl() {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ""
  ).trim();
}

function getFetchDispatcher() {
  const proxyUrl = getProxyUrl();
  return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}

function buildPromptText(prompt) {
  return [prompt.system, prompt.user].filter(Boolean).join("\n\n");
}

async function getErrorResponseBody(response) {
  const raw = await response.text();

  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function getStructuredDetails(details) {
  return JSON.stringify(details);
}

function parseStructuredDetails(details) {
  try {
    return JSON.parse(details || "{}");
  } catch {
    return {};
  }
}

function shouldFallbackImageModel(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const details = parseStructuredDetails(error?.details);
  const responseBody = details.responseBody || "";

  return (
    status === 400 ||
    status === 404 ||
    /model|unsupported|unavailable|not found|no endpoints|invalid/i.test(responseBody)
  );
}

function getNetworkFailure(error, durationMs) {
  const code = error?.cause?.code || error?.code || "";
  const message = error?.message || "The upstream model service could not be reached.";
  const details = {
    code: code || error?.name,
    message,
    durationMs,
    timeoutMs: REQUEST_TIMEOUT_MS
  };

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      message: "OpenRouter DNS lookup failed.",
      details: getStructuredDetails(details)
    };
  }

  if (
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    error?.name === "AbortError"
  ) {
    return {
      message: "OpenRouter request timed out.",
      details: getStructuredDetails(details)
    };
  }

  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH") {
    return {
      message: "OpenRouter network connection failed.",
      details: getStructuredDetails(details)
    };
  }

  return {
    message: "OpenRouter network request failed.",
    details: getStructuredDetails(details)
  };
}

function getHttpFailure(response, responseBody, durationMs) {
  const details = getStructuredDetails({
    status: response.status,
    statusText: response.statusText,
    responseBody,
    durationMs
  });

  if (response.status === 401) {
    return {
      status: 401,
      message: "OpenRouter rejected the API key.",
      details
    };
  }

  if (response.status === 403) {
    return {
      status: 403,
      message: "OpenRouter rejected access to this request.",
      details
    };
  }

  if (response.status === 404) {
    return {
      status: 404,
      message: "OpenRouter endpoint or model was not found.",
      details
    };
  }

  if (response.status === 429) {
    return {
      status: 429,
      message: "OpenRouter rate limit was reached.",
      details
    };
  }

  if (
    response.status === 400 &&
    /model|not found|unavailable|no endpoints|invalid/i.test(responseBody || "")
  ) {
    return {
      status: 400,
      message: "OpenRouter model is invalid or unavailable.",
      details
    };
  }

  return {
    status: response.status >= 500 ? 502 : response.status,
    message: `OpenRouter returned HTTP ${response.status}.`,
    details
  };
}

async function validateImageForOpenRouter(imagePath) {
  let stats;

  try {
    stats = await fs.stat(imagePath);
  } catch (error) {
    throw new AppError(
      "The image could not be read before sending it to OpenRouter.",
      400,
      getStructuredDetails({
        imagePath,
        code: error?.code,
        message: error?.message
      })
    );
  }

  if (!stats.isFile()) {
    throw new AppError(
      "The image path does not point to a file.",
      400,
      getStructuredDetails({ imagePath })
    );
  }

  if (stats.size >= IMAGE_LIMITS.maxBytes) {
    throw new AppError(
      "Image is too large for OpenRouter vision analysis.",
      413,
      getStructuredDetails({
        imagePath,
        sizeBytes: stats.size,
        maxBytes: IMAGE_LIMITS.maxBytes
      })
    );
  }

  return stats;
}

export function createOpenRouterClient() {
  async function fetchOpenRouterJson({ requestUrl, model, body, imageMeta }) {
    const controller = new AbortController();
    const startTime = Date.now();
    const timeout = setTimeout(() => {
      const durationMs = Date.now() - startTime;
      logWarn("openrouter.timeout", {
        url: requestUrl,
        model,
        durationMs,
        timeoutMs: REQUEST_TIMEOUT_MS
      });
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let response;
    try {
      const dispatcher = getFetchDispatcher();

      logInfo("openrouter.request.start", {
        url: requestUrl,
        model,
        imagePath: imageMeta?.imagePath,
        imageSizeBytes: imageMeta?.size,
        mimeType: imageMeta?.mimeType,
        proxyEnabled: Boolean(dispatcher),
        timeoutMs: REQUEST_TIMEOUT_MS
      });

      response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.publicAppUrl,
          "X-Title": "SmartHandle Pro"
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        dispatcher
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const failure = getNetworkFailure(error, durationMs);
      logWarn("openrouter.request.error", {
        url: requestUrl,
        model,
        durationMs,
        details: failure.details
      });
      throw new AppError(failure.message, 502, failure.details);
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = Date.now() - startTime;
    logInfo("openrouter.response", {
      url: requestUrl,
      status: response.status,
      durationMs
    });

    if (!response.ok) {
      const responseBody = await getErrorResponseBody(response);
      logWarn("openrouter.response.error", {
        url: requestUrl,
        status: response.status,
        durationMs,
        responseBody
      });
      const failure = getHttpFailure(response, responseBody, durationMs);
      throw new AppError(failure.message, failure.status, failure.details);
    }

    return response.json();
  }

  async function callImageModel(imagePath, prompt, options = {}) {
    const model = options.model || VISION_MODEL;
    const imageStats = await validateImageForOpenRouter(imagePath);
    const imageBuffer = await fs.readFile(imagePath);
    const imageBase64 = imageBuffer.toString("base64");
    const requestUrl = `${env.openRouterBaseUrl}/chat/completions`;

    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPromptText(prompt) },
            {
              type: "image_url",
              image_url: {
                url: getDataUrl(options.mimeType, imageBase64)
              }
            }
          ]
        }
      ],
      max_tokens: options.maxTokens ?? 1000,
      temperature: options.temperature ?? 0
    };

    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    return fetchOpenRouterJson({
      requestUrl,
      model,
      body,
      imageMeta: {
        imagePath,
        size: imageStats.size,
        mimeType: options.mimeType
      }
    });
  }

  async function callTextModel(prompt, options = {}) {
    const model = options.model || VISION_MODEL;
    const requestUrl = `${env.openRouterBaseUrl}/chat/completions`;
    const messages = [];

    if (prompt.system) {
      messages.push({ role: "system", content: prompt.system });
    }

    messages.push({ role: "user", content: prompt.user || "" });

    const body = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 1000,
      temperature: options.temperature ?? 0
    };

    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    return fetchOpenRouterJson({
      requestUrl,
      model,
      body
    });
  }

  async function callImageGenerationModelInternal(imagePath, prompt, options = {}) {
    const model = options.model || IMAGE_GENERATION_MODEL;
    const sourceImage = await buildImageContent(imagePath, options.mimeType);
    const referenceImages = await Promise.all(
      (options.referenceImages || []).map((referenceImage) =>
        buildImageContent(referenceImage.path, referenceImage.mimeType)
      )
    );
    const requestUrl = `${env.openRouterBaseUrl}/chat/completions`;

    return fetchOpenRouterJson({
      requestUrl,
      model,
      body: {
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPromptText(prompt) },
              sourceImage.content,
              ...referenceImages.map((referenceImage) => referenceImage.content)
            ]
          }
        ],
        modalities: ["image"],
        temperature: options.temperature ?? 0
      },
      imageMeta: {
        imagePath,
        size: sourceImage.stats.size,
        mimeType: options.mimeType
      }
    });
  }

  return {
    model: VISION_MODEL,
    imageGenerationModel: IMAGE_GENERATION_MODEL,
    async callTextModel(prompt, options = {}) {
      return callTextModel(prompt, options);
    },
    async callVisionModel(imagePath, prompt, options = {}) {
      return callImageModel(imagePath, prompt, options);
    },
    async callImageGenerationModel(imagePath, prompt, options = {}) {
      try {
        return await callImageGenerationModelInternal(imagePath, prompt, {
          ...options,
          model: IMAGE_GENERATION_MODEL
        });
      } catch (error) {
        if (!shouldFallbackImageModel(error)) {
          throw error;
        }

        logWarn("openrouter.image_generation.fallback", {
          primaryModel: IMAGE_GENERATION_MODEL,
          fallbackModel: IMAGE_GENERATION_FALLBACK_MODEL,
          status: error.status,
          details: error.details
        });

        return callImageGenerationModelInternal(imagePath, prompt, {
          ...options,
          model: IMAGE_GENERATION_FALLBACK_MODEL
        });
      }
    }
  };
}
