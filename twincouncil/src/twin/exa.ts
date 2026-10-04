import { MCPClient } from '@mastra/mcp'

// Exa is the twin's only search engine. Its hosted MCP server connects without a key, but keyless
// use is capped low enough (the open-source server defaults to 50 calls a day per IP) that a full
// event scout will exceed it. Set EXA_API_KEY for real use.
const SEARCH_TOOLS = ['web_search_exa', 'web_search_advanced_exa']
const FETCH_TOOL = 'web_fetch_exa'

const url = new URL('https://mcp.exa.ai/mcp')
url.searchParams.set('tools', [...SEARCH_TOOLS, FETCH_TOOL].join(','))

const apiKey = process.env.EXA_API_KEY

export const exa = new MCPClient({
  id: 'twin-exa',
  servers: {
    exa: {
      url,
      ...(apiKey ? { requestInit: { headers: { 'x-api-key': apiKey } } } : {}),
    },
  },
})

type ExaTools = Awaited<ReturnType<typeof exa.listTools>>
type LooseTool = { execute?: (input: unknown, context: unknown) => Promise<unknown> }

let tools: Promise<ExaTools> | undefined

function allTools(): Promise<ExaTools> {
  // listTools() skips a server it cannot reach and resolves with nothing, which would be cached
  // as "Exa has no tools"; the WithErrors form lets a failed connection be retried next time.
  tools ??= exa
    .listToolsWithErrors()
    .then(({ tools: found, errors }) => {
      if (errors.exa || Object.keys(found).length === 0) {
        throw new Error(`Exa MCP is unreachable: ${errors.exa ? String(errors.exa) : 'it listed no tools'}`)
      }
      return found
    })
    .catch(err => {
      tools = undefined
      throw err
    })
  return tools
}

// Mastra namespaces MCP tools as `<server>_<tool>`.
const named = (key: string, name: string) => key === name || key === `exa_${name}`

/** The search tools, and nothing else, for agents that are allowed to search. */
export async function exaSearchToolset(): Promise<{ exa: ExaTools }> {
  const all = await allTools()
  const picked: ExaTools = {}
  for (const [key, tool] of Object.entries(all)) {
    if (SEARCH_TOOLS.some(name => named(key, name))) picked[key] = tool
  }
  if (Object.keys(picked).length === 0) {
    throw new Error(`Exa MCP offers none of ${SEARCH_TOOLS.join(', ')}. It offers: ${Object.keys(all).join(', ') || 'nothing'}`)
  }
  return { exa: picked }
}
export type SearchToolset = Awaited<ReturnType<typeof exaSearchToolset>>

function toText(result: unknown): string {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const { content, error, isError } = result as { content?: unknown; error?: unknown; isError?: unknown }
    if (error || isError) return ''
    if (Array.isArray(content)) {
      return content.map(part => (part && typeof part === 'object' && 'text' in part ? String(part.text) : '')).join('\n')
    }
  }
  return JSON.stringify(result ?? '')
}

/** Exa's cached copy of a page, called from code (no model involved). Null if Exa cannot read it. */
export async function exaFetchText(pageUrl: string): Promise<string | null> {
  const entry = Object.entries(await allTools()).find(([key]) => named(key, FETCH_TOOL))
  const tool = entry?.[1] as LooseTool | undefined
  if (!tool?.execute) return null
  try {
    // Exa returns 3,000 characters per page unless asked for more.
    const text = toText(await tool.execute({ urls: [pageUrl], maxCharacters: 14000 }, {}))
    return text.length > 200 ? text : null
  } catch {
    return null
  }
}
