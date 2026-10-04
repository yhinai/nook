import { researchResponseSchema } from '../provider-protocol'
import type { SidequestProvider } from '../provider'
import type {
  LifeAgentConfig,
  LifeTeamSettings,
  LifeAgentReport
} from '../../../shared/sidequest/life-team'

export const healthDomains = [
  'nhs.uk',
  'cdc.gov',
  'who.int',
  'nih.gov',
  'mayoclinic.org',
  'acsm.org'
]
const publicTopics = [
  {
    pattern: /github|repositories|repository|open.source/i,
    topic: 'GitHub open source repositories practical examples'
  },
  {
    pattern: /arxiv|state.of.the.art|research paper|ai paper|machine learning/i,
    topic: 'arXiv artificial intelligence research papers reproducible examples'
  },
  {
    pattern: /hackathon|personal agent|ai agent/i,
    topic: 'personal AI agent hackathon project examples'
  },
  { pattern: /photo|camera/i, topic: 'beginner photography practice' },
  { pattern: /run|walk|hiking/i, topic: 'walking and recreational running routines' },
  { pattern: /sleep|rest/i, topic: 'healthy sleep routines' },
  { pattern: /cook|food|meal/i, topic: 'simple meal planning' },
  { pattern: /code|coding|software|program/i, topic: 'small software project planning' },
  { pattern: /music|guitar|piano/i, topic: 'beginner music practice' },
  { pattern: /art|draw|paint/i, topic: 'beginner drawing practice' },
  { pattern: /read|learn|study/i, topic: 'effective learning practice' }
]
const domainTopics = {
  health: 'everyday wellbeing movement sleep and recovery guidance',
  work: 'small project next action planning',
  growth: 'learning through short deliberate practice',
  people: 'low cost shared activities with friends',
  discovery: 'free creative exploration ideas',
  admin: 'simple household task preparation checklist',
  money: 'tracking everyday spending and budgeting basics'
}

export function publicResearchQuery(agent: LifeAgentConfig, settings: LifeTeamSettings): string {
  const candidates = agent.id === 'health' ? publicTopics.slice(4, 7) : publicTopics
  const match = candidates.find(({ pattern }) => pattern.test(`${agent.goal} ${settings.focus}`))
  return `${domainTopics[agent.id]}${match ? ` ${match.topic}` : ''}`
}

export async function withinDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  milliseconds = 30000
): Promise<T> {
  parent.throwIfAborted()
  const controller = new AbortController()
  let rejectAbort: (reason: Error) => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const stop = () => {
    controller.abort()
    rejectAbort(new Error('Life Team request timed out or was interrupted.'))
  }
  const timer = setTimeout(stop, milliseconds)
  parent.addEventListener('abort', stop, { once: true })
  try {
    controller.signal.throwIfAborted()
    return await Promise.race([operation(controller.signal), aborted])
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', stop)
  }
}

export function permittedSource(url: string, health: boolean): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      (!health ||
        healthDomains.some(
          (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
        ))
    )
  } catch {
    return false
  }
}

export async function researchSpecialist(
  agent: LifeAgentConfig,
  settings: LifeTeamSettings,
  provider: SidequestProvider,
  signal: AbortSignal
) {
  let status: LifeAgentReport['researchStatus'] = 'off'
  if (!settings.research || !provider.exaKey) {
    return { status, results: [] }
  }
  try {
    const body = await withinDeadline(async (requestSignal) => {
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        signal: requestSignal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': provider.exaKey ?? '' },
        body: JSON.stringify({
          query: publicResearchQuery(agent, settings),
          numResults: 3,
          type: 'auto',
          contents: { highlights: true },
          ...(agent.id === 'health' ? { includeDomains: healthDomains } : {})
        })
      })
      if (!response.ok) {
        throw new Error('Public search unavailable.')
      }
      return researchResponseSchema.parse(await response.json())
    }, signal)
    const results = (body.results ?? [])
      .filter((result) => permittedSource(result.url, agent.id === 'health'))
      .slice(0, 3)
      .map((result) => ({
        title: (result.title || 'Public source').slice(0, 300),
        url: result.url,
        highlights: (result.highlights ?? []).slice(0, 2).map((value) => value.slice(0, 1200))
      }))
    status = results.length ? 'retrieved' : 'unavailable'
    return { status, results }
  } catch {
    signal.throwIfAborted()
    return { status: 'unavailable' as const, results: [] }
  }
}
