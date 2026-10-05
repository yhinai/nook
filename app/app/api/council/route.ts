import { resolveNookIdentity, identityHeaders } from "@/lib/nook-identity";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { councilInput, runCouncil } from "@/lib/council-agent";
import { runBackendCouncil } from "@/lib/nook-backend";
import { chatConfig } from "@/lib/chat-agent";
import { resolveAIConfig, aiProviderLabel } from "@/lib/ai-config";

function config() {
  const bindings = env as unknown as Record<string, string | undefined>;
  const backend = chatConfig(bindings);
  return { ...resolveAIConfig(bindings), url: backend.url, registrationKey: backend.registrationKey };
}
function backendConfigured(settings: ReturnType<typeof config>) { return Boolean(settings.url && settings.registrationKey); }
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  let settings;
  try { settings = config(); } catch { return Response.json({ available: false, provider: "AI provider", requiresSignIn: false, configurationError: true }, { headers }); }
  const configured = Boolean(settings.key || backendConfigured(settings));
  const session = resolveNookIdentity(request, (await getChatGPTUser())?.userId);
  return Response.json({ available: configured, provider: backendConfigured(settings) ? "Nook · Mastra" : aiProviderLabel(settings), requiresSignIn: false }, { headers: identityHeaders(session, headers) });
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request must come from your Nook workspace." }, { status: 403, headers });
  const session = resolveNookIdentity(request, (await getChatGPTUser())?.userId);
  const responseHeaders = identityHeaders(session, headers);
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return Response.json({ error: "This situation is too long. Please keep it under 1,000 characters." }, { status: 413, headers: responseHeaders });
    input = councilInput.parse(JSON.parse(raw));
  } catch { return Response.json({ error: "Please provide a question and a valid Twin profile." }, { status: 400, headers: responseHeaders }); }
  let settings;
  try { settings = config(); } catch { return Response.json({ error: "The server AI endpoint is invalid. Configure AI_BASE_URL with an HTTPS API base URL.", code: "PROVIDER_CONFIG" }, { status: 503, headers: responseHeaders }); }
  if (!settings.key && !backendConfigured(settings)) return Response.json({ error: "Live AI is not configured. Use the local preview or configure AI_API_KEY, GOOGLE_API_KEY or OPENAI_API_KEY on the server.", code: "NOT_CONFIGURED" }, { status: 503, headers: responseHeaders });
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.signal.aborted) controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 60000);
  try { if (controller.signal.aborted) return Response.json({ error: "This reflection was cancelled." }, { status: 499, headers: responseHeaders }); return Response.json(await (backendConfigured(settings) ? runBackendCouncil(input, session.userId, settings, controller.signal) : runCouncil(input, settings, controller.signal)), { headers: responseHeaders }); }
  catch (error) {
    const rateLimit = error instanceof Error && error.message === "RATE_LIMIT";
    const invalidConfig = error instanceof Error && error.message === "PROVIDER_CONFIG";
    return Response.json({ error: controller.signal.aborted ? "The council took too long. Please try again." : invalidConfig ? "The AI provider rejected the server configuration. Check the API key and model access." : rateLimit ? "The AI service is busy. Please try again shortly." : "The council could not complete this reflection. Please try again or use preview mode." }, { status: rateLimit ? 429 : 502, headers: responseHeaders });
  } finally { clearTimeout(timeout); controller.abort(); request.signal.removeEventListener("abort", abort); }
}
