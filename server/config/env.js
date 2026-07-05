import "dotenv/config";

export function validateEnv() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Startup failed: OPENROUTER_API_KEY is missing.",
        details: "Add OPENROUTER_API_KEY to .env before starting SmartHandle Pro."
      })
    );
    process.exit(1);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim(),
  openRouterBaseUrl: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(
    /\/+$/,
    ""
  ),
  publicAppUrl: process.env.PUBLIC_APP_URL || "http://localhost:5173"
};
