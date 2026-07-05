function serializeMeta(meta = {}) {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined && value !== null)
  );
}

export function logInfo(message, meta = {}) {
  console.log(JSON.stringify({ level: "info", message, ...serializeMeta(meta) }));
}

export function logWarn(message, meta = {}) {
  console.warn(JSON.stringify({ level: "warn", message, ...serializeMeta(meta) }));
}

export function logError(message, error, meta = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      message,
      error: error?.message || String(error),
      stack: error?.stack,
      ...serializeMeta(meta)
    })
  );
}
