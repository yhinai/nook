const failures: Record<string, string> = {
  RATE_LIMIT: "The AI service is busy. Please try again shortly.",
  PROVIDER_CONFIG: "The AI provider rejected its configuration. Check the server’s API key, model and provider URL.",
  PROVIDER_ERROR: "The AI provider is temporarily unavailable. Please try again shortly.",
  INVALID_RESPONSE: "The AI provider returned an unreadable reply after retrying. Please try again.",
  RESPONSE_TRUNCATED: "The AI provider could not finish its reply. Please try a shorter request.",
  BACKEND_REGISTRATION_FAILED: "Nook could not connect your Twin identity. Check the backend URL and registration key.",
  BACKEND_ERROR: "Nook’s agent backend could not complete this request. Please try again shortly.",
  INVALID_BACKEND_URL: "Nook’s backend URL is invalid. Check the server configuration.",
  AGENT_NOT_CONNECTED: "Connect with that person’s Twin first. No message was sent.",
  RECIPIENT_AMBIGUOUS: "More than one connected Twin has that name. Use their full name. No message was sent.",
  GROUNDING_FAILED: "Your Twin could not verify the research well enough to recommend options. Please try again with a more specific request.",
};
export function chatFailure(error: unknown, aborted = false) {
  const reason = error instanceof Error ? error.message : "";
  const code = aborted ? "TIMEOUT" : Object.hasOwn(failures, reason) ? reason : "CHAT_FAILED";
  return { error: aborted ? "Your Twin took too long. Please try again." : failures[code] || "Your Twin could not respond. Please try again.", code, status: code === "RATE_LIMIT" ? 429 : ["AGENT_NOT_CONNECTED", "RECIPIENT_AMBIGUOUS"].includes(code) ? 409 : 502 };
}
