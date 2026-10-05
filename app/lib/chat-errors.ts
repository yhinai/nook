const failures: Record<string, string> = {
  INVITATION_INVALID: "That invitation code is invalid, expired or already accepted. Ask for a new code.",
  REQUEST_RECIPIENT_ONLY: "Only the person who received this connection request can respond.",
  SELF_CONNECTION: "Choose another person’s Twin or use their invitation code.",
  CONNECTION_INACTIVE: "This Twin connection is no longer active. Reconnect before sending a message.",
  REQUEST_CONFLICT: "This request was already used for different content. Start a new message.",
  MULTIPLE_RECIPIENTS: "Send to one connected Twin at a time. No message was sent.",
  ALREADY_RUNNING: "Your Twin is still working on another request. Please wait a moment.",
  RATE_LIMIT: "The AI service is busy. Please try again shortly.",
  PROVIDER_CONFIG: "The AI provider rejected its configuration. Check the server’s API key, model and provider URL.",
  PROVIDER_QUOTA: "The AI provider has no available credits. Add credits or configure another provider on the server.",
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
  return { error: aborted ? "Your Twin took too long. Please try again." : failures[code] || "Your Twin could not respond. Please try again.", code, status: code === "RATE_LIMIT" ? 429 : ["REQUEST_RECIPIENT_ONLY", "AGENT_NOT_CONNECTED", "RECIPIENT_AMBIGUOUS", "INVITATION_INVALID", "SELF_CONNECTION", "CONNECTION_INACTIVE", "REQUEST_CONFLICT", "MULTIPLE_RECIPIENTS", "ALREADY_RUNNING"].includes(code) ? 409 : 502 };
}
