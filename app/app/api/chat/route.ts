import { chatFailure } from "@/lib/chat-errors";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { chatConfig, chatInput, localChatIdentity, runChat } from "@/lib/chat-agent";
import { runBackendChat } from "@/lib/nook-backend";

const headers = { "Cache-Control": "no-store" };
const config = () => chatConfig(env as unknown as Record<string, unknown>);
const hasBackend = (settings: ReturnType<typeof config>) => Boolean(settings.url && settings.registrationKey);
const available = (settings: ReturnType<typeof config>) => Boolean(settings.key || hasBackend(settings));
async function identity(request: Request) { return (await getChatGPTUser())?.userId || localChatIdentity(request, process.env.NODE_ENV !== "production" || config().allowLocalChat); }
export async function GET(request: Request) {
  const settings = config();
  const configured = available(settings);
  const userId = configured ? await identity(request) : null;
  return Response.json({ available: configured && Boolean(userId), requiresSignIn: configured && !userId, agentsAvailable: hasBackend(settings) && Boolean(userId), provider: hasBackend(settings) ? "nook" : settings.key ? settings.provider === "google" ? "google" : settings.baseUrl && new URL(settings.baseUrl).hostname !== "api.openai.com" ? "compatible" : "openai" : null, researchAvailable: Boolean(settings.exaKey) }, { headers });
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request must come from your Nook workspace." }, { status: 403, headers });
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return Response.json({ error: "This conversation is too long. Please send a shorter message." }, { status: 413, headers });
    input = chatInput.parse(JSON.parse(raw));
  } catch { return Response.json({ error: "Please provide a message and a valid Twin profile." }, { status: 400, headers }); }
  const settings = config();
  if (!available(settings)) return Response.json({ error: "Connect an AI provider on the server to chat with your Twin.", code: "NOT_CONFIGURED" }, { status: 503, headers });
  const userId = await identity(request);
  if (!userId) return Response.json({ error: "Please sign in before chatting with your Twin." }, { status: 401, headers });
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.signal.aborted) abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 60000);
  try {
    if (controller.signal.aborted) throw new Error("CANCELLED");
    return Response.json(await (hasBackend(settings) ? runBackendChat(input, userId, settings, controller.signal) : runChat(input, settings, controller.signal)), { headers });
  } catch (error) {
    const failure = chatFailure(error, controller.signal.aborted);
    console.error("Nook chat failed", { code: failure.code });
    return Response.json({ error: failure.error, code: failure.code }, { status: failure.status, headers });
  } finally { clearTimeout(timeout); controller.abort(); request.signal.removeEventListener("abort", abort); }
}
