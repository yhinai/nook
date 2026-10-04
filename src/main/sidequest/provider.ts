import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

export type SidequestProvider = {
  key?: string
  exaKey?: string
  baseUrl: string
  model: string
}

export function readSidequestProvider(
  directory: string,
  environment: NodeJS.ProcessEnv = process.env
): SidequestProvider {
  let saved: Record<string, string | undefined> = {}
  try {
    saved = parseEnv(readFileSync(join(directory, 'provider.env'), 'utf8'))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw new Error('Sidequest could not read its provider configuration.')
    }
  }
  const value = (name: string): string | undefined => environment[name] || saved[name]
  const openRouterKey = value('OPENROUTER_API_KEY')
  const key = value('AI_API_KEY') || openRouterKey || value('OPENAI_API_KEY')
  const baseUrl =
    value('AI_BASE_URL') ||
    (openRouterKey ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('Sidequest needs a valid AI provider URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Sidequest needs an HTTPS AI provider URL without credentials or parameters.')
  }
  return {
    key,
    exaKey: value('EXA_API_KEY'),
    baseUrl: url.toString().replace(/\/$/, ''),
    model: value('AI_MODEL') || (openRouterKey ? 'openai/gpt-4.1-mini' : 'gpt-4.1-mini')
  }
}
