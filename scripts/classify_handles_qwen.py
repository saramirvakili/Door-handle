#!/usr/bin/env python3
"""
Classify door handle product images with Qwen2.5-VL and write a catalog JSON file.

Input:  F:\\door-2\\public\\handles
Output: F:\\door-2\\server\\data\\catalog.json

Required environment:
  QWEN_API_KEY

Optional environment:
  QWEN_API_URL       OpenAI-compatible chat completions endpoint.
                     Defaults to OpenRouter.
  QWEN_MODEL         Defaults to qwen/qwen2.5-vl-72b-instruct.
  QWEN_RATE_DELAY    Seconds to sleep between requests. Defaults to 1.0.
  QWEN_MAX_RETRIES   Retry count per image. Defaults to 4.
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
import random
import re
import time
from pathlib import Path
from typing import Any

import requests


SOURCE_DIR = Path(r"F:\door-2\public\handles")
OUTPUT_FILE = Path(r"F:\door-2\server\data\catalog.json")
FALLBACK_OUTPUT_FILE = Path(r"F:\door-2\server\data\handles.json")

API_URL = os.getenv("QWEN_API_URL", "https://openrouter.ai/api/v1/chat/completions")
MODEL_NAME = os.getenv("QWEN_MODEL", "qwen/qwen2.5-vl-72b-instruct")
API_KEY_ENV = "QWEN_API_KEY"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
REQUEST_TIMEOUT_SECONDS = 120
RATE_DELAY_SECONDS = float(os.getenv("QWEN_RATE_DELAY", "1.0"))
MAX_RETRIES = int(os.getenv("QWEN_MAX_RETRIES", "4"))

ALLOWED_LABELS = {
    "style": {"modern", "classic", "neoclassical", "minimal"},
    "color": {"gold", "silver", "black", "bronze", "chrome"},
    "material": {"brass", "steel", "zamak", "aluminum"},
    "compatibility": {"wood", "glass", "metal"},
}

DEFAULT_CLASSIFICATION = {
    "style": "modern",
    "color": "chrome",
    "material": "steel",
    "compatibility": "wood",
}

JSON_SCHEMA = {
    "name": "door_handle_catalog_item",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "style", "color", "material", "compatibility"],
        "properties": {
            "id": {"type": "integer"},
            "style": {"type": "string", "enum": sorted(ALLOWED_LABELS["style"])},
            "color": {"type": "string", "enum": sorted(ALLOWED_LABELS["color"])},
            "material": {"type": "string", "enum": sorted(ALLOWED_LABELS["material"])},
            "compatibility": {
                "type": "string",
                "enum": sorted(ALLOWED_LABELS["compatibility"]),
            },
        },
    },
}

PROMPT = """You are analyzing a product image of a door handle.
Classify only the handle product itself. Ignore the background completely.
Return exactly one valid JSON object. Do not output markdown or explanations.

Use only these allowed labels:
style: modern, classic, neoclassical, minimal
color: gold, silver, black, bronze, chrome
material: brass, steel, zamak, aluminum
compatibility: wood, glass, metal

If uncertain, choose the closest valid label.

Return this exact schema:
{
  "id": 1,
  "style": "modern",
  "color": "chrome",
  "material": "steel",
  "compatibility": "wood"
}"""


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def image_id(path: Path) -> int | None:
    if path.stem.isdigit():
        return int(path.stem)
    return None


def natural_image_key(path: Path) -> tuple[int, int | str]:
    numeric_id = image_id(path)
    if numeric_id is not None:
        return (0, numeric_id)
    return (1, path.name.lower())


def collect_images(source_dir: Path) -> list[Path]:
    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")

    images = sorted(
        [
            path
            for path in source_dir.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ],
        key=natural_image_key,
    )

    numeric_ids = sorted(id_value for path in images if (id_value := image_id(path)) is not None)
    if numeric_ids:
        present = set(numeric_ids)
        for expected_id in range(numeric_ids[0], numeric_ids[-1] + 1):
            if expected_id not in present:
                logging.warning("Missing handle image for numeric id %s", expected_id)

    non_numeric = [path.name for path in images if image_id(path) is None]
    if non_numeric:
        logging.warning("Skipping non-numeric image filenames: %s", ", ".join(non_numeric))

    return [path for path in images if image_id(path) is not None]


def image_to_data_url(path: Path) -> str:
    mime_type = mimetypes.guess_type(path.name)[0]
    if mime_type not in {"image/png", "image/jpeg", "image/webp"}:
        mime_type = "image/jpeg"

    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def build_payload(path: Path, use_json_schema: bool = True) -> dict[str, Any]:
    numeric_id = image_id(path)
    if numeric_id is None:
        raise ValueError(f"Filename must start with a numeric id: {path.name}")

    payload: dict[str, Any] = {
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"{PROMPT}\n\nThe id must be {numeric_id}."},
                    {"type": "image_url", "image_url": {"url": image_to_data_url(path)}},
                ],
            }
        ],
        "temperature": 0,
        "max_tokens": 300,
    }

    if use_json_schema:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": JSON_SCHEMA,
        }
    else:
        payload["response_format"] = {"type": "json_object"}

    return payload


def auth_headers(api_key: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    if "openrouter.ai" in API_URL:
        headers["HTTP-Referer"] = "https://localhost/smarthandle-pro"
        headers["X-Title"] = "SmartHandle Pro Catalog Classifier"

    return headers


def extract_first_json_object(text: str) -> str:
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in model response.")

    depth = 0
    in_string = False
    escape = False

    for index in range(start, len(text)):
        char = text[index]

        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]

    raise ValueError("Unclosed JSON object in model response.")


def parse_json_response(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        parsed = json.loads(extract_first_json_object(cleaned))

    if not isinstance(parsed, dict):
        raise ValueError("Model response JSON is not an object.")

    return parsed


def normalize_label(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower().replace("-", "_").replace(" ", "_")


def normalize_classification(raw: dict[str, Any], expected_id: int) -> dict[str, Any]:
    item: dict[str, Any] = {"id": expected_id}

    for field, allowed_values in ALLOWED_LABELS.items():
        value = normalize_label(raw.get(field))
        if value in allowed_values:
            item[field] = value
        else:
            fallback = DEFAULT_CLASSIFICATION[field]
            logging.warning(
                "Invalid or missing %s=%r for id %s; using %s",
                field,
                raw.get(field),
                expected_id,
                fallback,
            )
            item[field] = fallback

    raw_id = raw.get("id")
    if raw_id != expected_id:
        logging.warning("Model returned id=%r for %s; forcing id=%s", raw_id, expected_id, expected_id)

    return item


def response_text(response_json: dict[str, Any]) -> str:
    message = response_json["choices"][0]["message"]
    content = message.get("content")

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        if parts:
            return "\n".join(parts)

    if isinstance(content, dict):
        return json.dumps(content, ensure_ascii=False)

    raise ValueError("Unexpected response content format.")


def post_with_retries(
    session: requests.Session,
    api_key: str,
    path: Path,
) -> dict[str, Any]:
    last_error: Exception | None = None
    use_json_schema = True

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            payload = build_payload(path, use_json_schema=use_json_schema)
            response = session.post(
                API_URL,
                headers=auth_headers(api_key),
                json=payload,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )

            if response.status_code == 400 and use_json_schema:
                logging.warning(
                    "JSON Schema response_format was rejected for %s; retrying with json_object.",
                    path.name,
                )
                use_json_schema = False
                continue

            if response.status_code in {408, 409, 429, 500, 502, 503, 504}:
                raise requests.HTTPError(
                    f"Transient HTTP {response.status_code}: {response.text[:500]}",
                    response=response,
                )

            response.raise_for_status()
            return response.json()

        except (requests.RequestException, ValueError) as error:
            last_error = error
            if attempt >= MAX_RETRIES:
                break

            sleep_seconds = min(60.0, (2 ** (attempt - 1)) + random.uniform(0.25, 1.25))
            logging.warning(
                "Attempt %s/%s failed for %s: %s. Retrying in %.1fs.",
                attempt,
                MAX_RETRIES,
                path.name,
                error,
                sleep_seconds,
            )
            time.sleep(sleep_seconds)

    raise RuntimeError(f"API request failed for {path.name}: {last_error}")


def classify_image(session: requests.Session, api_key: str, path: Path) -> dict[str, Any]:
    expected_id = image_id(path)
    if expected_id is None:
        raise ValueError(f"Image filename is not numeric: {path.name}")

    response_json = post_with_retries(session, api_key, path)
    raw = parse_json_response(response_text(response_json))
    return normalize_classification(raw, expected_id)


def write_catalog(catalog: list[dict[str, Any]]) -> Path:
    data = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"

    try:
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_FILE.write_text(data, encoding="utf-8")
        return OUTPUT_FILE
    except OSError as error:
        logging.warning("Could not write %s: %s", OUTPUT_FILE, error)
        FALLBACK_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_OUTPUT_FILE.write_text(data, encoding="utf-8")
        return FALLBACK_OUTPUT_FILE


def main() -> int:
    configure_logging()

    api_key = os.getenv(API_KEY_ENV)
    if not api_key:
        raise RuntimeError(f"Missing API key. Set environment variable {API_KEY_ENV}.")

    images = collect_images(SOURCE_DIR)
    logging.info("Found %s handle images in %s", len(images), SOURCE_DIR)

    catalog: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []

    with requests.Session() as session:
        for index, path in enumerate(images, start=1):
            logging.info("Classifying %s (%s/%s)", path.name, index, len(images))

            try:
                catalog.append(classify_image(session, api_key, path))
            except Exception as error:
                logging.error("Skipping %s after failure: %s", path.name, error)
                failures.append({"filename": path.name, "error": str(error)})

            if RATE_DELAY_SECONDS > 0 and index < len(images):
                time.sleep(RATE_DELAY_SECONDS)

    catalog.sort(key=lambda item: item["id"])
    output_path = write_catalog(catalog)

    logging.info("Classification complete.")
    logging.info("Succeeded: %s", len(catalog))
    logging.info("Failed: %s", len(failures))
    logging.info("Output: %s", output_path)

    if failures:
        failure_log = output_path.with_suffix(".failures.json")
        failure_log.write_text(json.dumps(failures, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        logging.warning("Failure details saved to %s", failure_log)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
