// Only explicit commands authorize delivery. Names are resolved by the server
// against the caller's active connections, never an AI-generated recipient.
export function agentMessageCommand(question: string) {
  const match = question.trim().match(/^(?:(?:can you|could you|would you|please)\s+)?(invite|message|tell|ask|send\s+(?:a\s+)?message\s+to)\s+(.+?)[.!?]?$/i)
  if (!match) return null
  return { verb: match[1].toLowerCase(), target: match[2].trim(), content: question.trim() }
}
