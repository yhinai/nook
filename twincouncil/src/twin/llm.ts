import { z } from 'zod'
import type { Agent } from '@mastra/core/agent'
import type { SearchToolset } from './exa.ts'
import { log } from './log.ts'

const CALL_TIMEOUT_MS = 8 * 60_000
// Unset: the model's own default effort. Set TWIN_EFFORT=high for more thorough searching.
const effort = (['low', 'medium', 'high', 'xhigh', 'max'] as const).find(level => level === process.env.TWIN_EFFORT)

type AskOptions = {
  /** Shown in logs and errors. */
  label: string
  /** Search tools to hand the agent. Omit for agents that must not have any. */
  toolsets?: SearchToolset
  maxSteps?: number
}

function extractJson(text: string): unknown {
  const body = text.replace(/```(?:json)?/gi, '').trim()
  const start = body.search(/[[{]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start === -1 || end < start) return undefined
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Ask an agent for JSON matching `schema`. The answer is validated here and retried once with the
 * validation error, so nothing downstream depends on how a provider implements structured output.
 */
export async function askJson<S extends z.ZodType>(
  agent: Agent,
  prompt: string,
  schema: S,
  options: AskOptions,
): Promise<z.infer<S>> {
  const contract = `\n\nAnswer with a single JSON value and nothing else: no prose, no code fences. It must validate against this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`
  let problem = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const retry = problem ? `\n\nYour previous answer was rejected: ${problem}. Answer again with valid JSON only.` : ''
    const result = await agent.generate(prompt + contract + retry, {
      maxSteps: options.maxSteps ?? 1,
      toolsets: options.toolsets,
      modelSettings: { maxOutputTokens: 16000 },
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      ...(effort ? { providerOptions: { anthropic: { effort } } } : {}),
    })
    if (result.error) throw result.error
    const json = extractJson(result.text ?? '')
    const parsed = schema.safeParse(json)
    if (parsed.success) return parsed.data
    problem =
      json === undefined
        ? 'it contained no JSON (finish searching sooner and then answer)'
        : parsed.error.issues
            .slice(0, 3)
            .map(issue => `${issue.path.join('.') || 'value'}: ${issue.message}`)
            .join('; ')
    log(`  ${options.label}: answer rejected — ${problem}`)
  }
  throw new Error(`${options.label}: no valid answer after 2 attempts (${problem})`)
}
