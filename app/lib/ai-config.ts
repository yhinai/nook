import type { AgentConfig } from "./council-agent";

type Environment = Record<string, string | undefined>;

/** Resolve server-only credentials from worker bindings, with local env fallback. */
export function resolveAIConfig(bindings: Environment = {}, runtime: Environment = process.env): AgentConfig {
  const read = (name: string) => bindings[name]?.trim() || runtime[name]?.trim();
  const genericKey = read("AI_API_KEY");
  if (genericKey) {
    return { provider: "openai", key: genericKey, model: read("AI_MODEL") || read("OPENAI_MODEL") || "gpt-4.1-mini", baseUrl: normalizeAIBaseUrl(read("AI_BASE_URL") || "https://api.openai.com/v1") };
  }
  const googleKey = read("GOOGLE_API_KEY");
  if (googleKey) return { provider: "google", key: googleKey, model: read("GOOGLE_MODEL") || "gemini-2.5-flash" };
  return { provider: "openai", key: read("OPENAI_API_KEY") || "", model: read("OPENAI_MODEL") || "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1" };
}

export function normalizeAIBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("PROVIDER_CONFIG"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("PROVIDER_CONFIG");
  return url.toString().replace(/\/+$/, "");
}

export function aiProviderLabel(config: AgentConfig): string {
  if (config.provider === "google") return "Google Gemini";
  const host = new URL(config.baseUrl || "https://api.openai.com/v1").hostname;
  return host === "openrouter.ai" ? "OpenRouter" : host === "api.openai.com" ? "OpenAI" : "AI provider";
}
