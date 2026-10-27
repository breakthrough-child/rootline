// Server-side configuration. All model names come from env vars; nothing is hardcoded.

const env = (k: string) => (process.env[k] ?? "").trim();

export const config = {
  nebius: {
    apiKey: env("NEBIUS_API_KEY"),
    baseUrl: (env("NEBIUS_BASE_URL") || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, ""),
    visionBaseUrl: (env("NEBIUS_VISION_BASE_URL") || env("NEBIUS_BASE_URL") || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, ""),
    models: {
      nano: env("MODEL_NANO"),
      super: env("MODEL_SUPER"),
      ultra: env("MODEL_ULTRA"),
      vision: env("MODEL_VISION"),
      asr: env("MODEL_ASR"),
    },
    disableThinking: env("NEBIUS_DISABLE_THINKING") !== "false",
  },
  asr: {
    endpointUrl: env("ASR_ENDPOINT_URL"),
    apiKey: env("ASR_API_KEY") || env("NEBIUS_API_KEY"),
  },
  tavily: { apiKey: env("TAVILY_API_KEY") },
  supabase: {
    url: env("NEXT_PUBLIC_SUPABASE_URL"),
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  },
  demoMode: env("DEMO_MODE") === "true",
  /** Offline mock: fictional search corpus + deterministic heuristics instead of model calls. */
  offlineMock: env("OFFLINE_MOCK") === "true",
  limits: {
    maxQueries: Number(env("MAX_QUERIES") || 8),
    maxPages: Number(env("MAX_CANDIDATE_PAGES") || 40),
    maxPairs: Number(env("MAX_PAIRS") || 80),
    concurrency: Number(env("MODEL_CONCURRENCY") || 6),
  },
  /** USD per 1M tokens [in, out]. Defaults from nebius.com Token Factory pricing (Oct 2026); override via env. */
  pricing: {
    nano: [Number(env("PRICE_NANO_IN") || 0.06), Number(env("PRICE_NANO_OUT") || 0.24)],
    super: [Number(env("PRICE_SUPER_IN") || 0.3), Number(env("PRICE_SUPER_OUT") || 0.9)],
    ultra: [Number(env("PRICE_ULTRA_IN") || 1.0), Number(env("PRICE_ULTRA_OUT") || 3.0)],
    vision: [Number(env("PRICE_VISION_IN") || 0.3), Number(env("PRICE_VISION_OUT") || 0.9)],
  } as Record<string, [number, number]>,
};

export type Tier = "nano" | "super" | "ultra" | "vision" | "asr";

export function llmAvailable(tier: Tier): boolean {
  return !config.offlineMock && !!config.nebius.apiKey && !!config.nebius.models[tier];
}

export function searchAvailable(): boolean {
  return config.offlineMock || !!config.tavily.apiKey;
}

export function publicStatus() {
  return {
    demoMode: config.demoMode,
    offlineMock: config.offlineMock,
    llm: { nano: llmAvailable("nano"), super: llmAvailable("super"), ultra: llmAvailable("ultra"), vision: llmAvailable("vision") },
    asr: !config.offlineMock && (!!config.asr.endpointUrl || (!!config.nebius.apiKey && !!config.nebius.models.asr)),
    search: searchAvailable(),
    storage: config.supabase.url && config.supabase.serviceKey ? "supabase" : "local-json",
    models: config.nebius.models,
  };
}
