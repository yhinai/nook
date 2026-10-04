import { env } from "cloudflare:workers";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { chatConfig, chatInput, localChatIdentity } from "@/lib/chat-agent";
import { runBackendConnections } from "@/lib/nook-backend";
import { chatFailure } from "@/lib/chat-errors";

const inputSchema = z.object({ profile: chatInput.shape.profile, action: z.enum(["list", "invite", "accept", "inbox"]), invitationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).strict();
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Use your Nook workspace." }, { status: 403, headers });
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 10000) throw new Error("Too large");
    input = inputSchema.parse(JSON.parse(raw));
    if (input.action === "accept" && !input.invitationToken) throw new Error("Missing token");
  } catch { return Response.json({ error: "Provide a valid profile and connection request." }, { status: 400, headers }); }
  const settings = chatConfig(env as unknown as Record<string, unknown>);
  if (!settings.url || !settings.registrationKey) return Response.json({ error: "Connect the Nook agent backend to use Twin connections." }, { status: 503, headers });
  const userId = (await getChatGPTUser())?.userId || localChatIdentity(request, process.env.NODE_ENV !== "production" || settings.allowLocalChat);
  if (!userId) return Response.json({ error: "Sign in to connect your Twin." }, { status: 401, headers });
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.signal.aborted) abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    return Response.json(await runBackendConnections({ question: "Manage Twin connections", profile: input.profile }, userId, settings, controller.signal, input.action, input.invitationToken), { headers });
  } catch (error) {
    const failure = chatFailure(error, controller.signal.aborted);
    return Response.json({ error: failure.error, code: failure.code }, { status: failure.status, headers });
  } finally { clearTimeout(timeout); request.signal.removeEventListener("abort", abort); }
}
