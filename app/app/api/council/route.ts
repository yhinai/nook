import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { acquireCouncilBudget } from "@/lib/request-budget";
import { councilInput, runCouncil } from "@/lib/council-agent";
import { runBackendCouncil } from "@/lib/nook-backend";
import { resolveAIConfig, aiProviderLabel } from "@/lib/ai-config";

function config() {
  const bindings = env as unknown as Record<string, string | undefined>;
  return { ...resolveAIConfig(bindings), url: bindings.NOOK_API_URL || process.env.NOOK_API_URL || "", registrationKey: bindings.NOOK_REGISTRATION_KEY || process.env.NOOK_REGISTRATION_KEY || "" };
}
function backendConfigured(settings: ReturnType<typeof config>) { return Boolean(settings.url && settings.registrationKey); }
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  let settings;
  try { settings = config(); } catch { return Response.json({ available: false, provider: "AI provider", requiresSignIn: false, configurationError: true }, { headers }); }
  const configured = Boolean(settings.key || backendConfigured(settings));
  const user = configured ? await getChatGPTUser() : null;
  return Response.json({ available: configured && Boolean(user), provider: backendConfigured(settings) ? "Nook · Mastra" : aiProviderLabel(settings), requiresSignIn: configured && !user }, { headers });
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request must come from your Nook workspace." }, { status: 403, headers });
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return Response.json({ error: "This situation is too long. Please keep it under 1,000 characters." }, { status: 413, headers });
    input = councilInput.parse(JSON.parse(raw));
  } catch { return Response.json({ error: "Please provide a question and a valid Twin profile." }, { status: 400, headers }); }
  let settings;
  try { settings = config(); } catch { return Response.json({ error: "The server AI endpoint is invalid. Configure AI_BASE_URL with an HTTPS API base URL.", code: "PROVIDER_CONFIG" }, { status: 503, headers }); }
  if (!settings.key && !backendConfigured(settings)) return Response.json({ error: "Live AI is not configured. Use the local preview or configure AI_API_KEY, GOOGLE_API_KEY or OPENAI_API_KEY on the server.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Please sign in before using the live council." }, { status: 401, headers });
  const release = acquireCouncilBudget(user.userId);
  if (!release) return Response.json({ error: "Your council is busy or your hourly request budget is reached. Please try later." }, { status: 429, headers });
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.signal.aborted) controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 60000);
  try { if (controller.signal.aborted) return Response.json({ error: "This reflection was cancelled." }, { status: 499, headers }); return Response.json(await (backendConfigured(settings) ? runBackendCouncil(input, user.userId, settings, controller.signal) : runCouncil(input, settings, controller.signal)), { headers }); }
  catch (error) {
    const rateLimit = error instanceof Error && error.message === "RATE_LIMIT";
    const invalidConfig = error instanceof Error && error.message === "PROVIDER_CONFIG";
    return Response.json({ error: controller.signal.aborted ? "The council took too long. Please try again." : invalidConfig ? "The AI provider rejected the server configuration. Check the API key and model access." : rateLimit ? "The AI service is busy. Please try again shortly." : "The council could not complete this reflection. Please try again or use preview mode." }, { status: rateLimit ? 429 : 502, headers });
  } finally { clearTimeout(timeout); controller.abort(); request.signal.removeEventListener("abort", abort); release(); }
}
