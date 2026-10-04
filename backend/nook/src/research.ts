import type { SidequestProvider } from '../../../src/main/sidequest/provider.js'
import { researchResponseSchema } from '../../../src/main/sidequest/provider-protocol.js'
import {
  healthDomains,
  permittedSource,
  withinDeadline
} from '../../../src/main/sidequest/life-team/network.js'
import type { Decision } from './contracts.js'

const queries = {
  career: 'evaluating a job offer career learning opportunity work life balance checklist',
  wellbeing: 'healthy routines movement recovery sleep general wellbeing guidance',
  social: 'planning low cost shared activities with friends respecting preferences',
  travel: 'planning a short weekend trip budget availability travel preparation checklist',
  learning: 'deliberate practice choosing small learning experiments',
  general: 'making personal decisions values tradeoffs practical decision framework'
}
export type Research = {
  enabled: boolean
  searchQuery?(
    query: string,
    signal: AbortSignal
  ): Promise<{ status: Decision['researchStatus']; sources: Decision['sources'] }>
  search(
    category: Decision['category'],
    signal: AbortSignal
  ): Promise<{ status: Decision['researchStatus']; sources: Decision['sources'] }>
}
export function createExaResearch(provider: SidequestProvider): Research {
  async function searchQuery(query: string, signal: AbortSignal, wellbeing = false): Promise<{ status: Decision['researchStatus']; sources: Decision['sources'] }> {
    if (!provider.exaKey) {
      return { status: 'off', sources: [] }
    }
    try {
      const results = await withinDeadline(
        async (requestSignal) => {
          const response = await fetch('https://api.exa.ai/search', {
            method: 'POST',
            signal: requestSignal,
            headers: { 'Content-Type': 'application/json', 'x-api-key': provider.exaKey || '' },
            body: JSON.stringify({
              query,
              numResults: 3,
              type: 'auto',
              contents: { highlights: true, maxAgeHours: 24, livecrawlTimeout: 10000 },
              ...(wellbeing ? { includeDomains: healthDomains } : {})
            })
          })
          if (!response.ok) {
            throw new Error('Search unavailable.')
          }
          return researchResponseSchema.parse(await response.json())
        },
        signal,
        20000
      )
      const sources = (results.results || [])
        .filter((source) => permittedSource(source.url, wellbeing) && !/^https:\/\/(?:www\.)?exa\.ai\/library\//i.test(source.url))
        .slice(0, 3)
        .map((source) => ({
          title: (source.title || 'Public source').slice(0, 300),
          url: source.url,
          highlights: (source.highlights || [])
            .slice(0, 2)
            .map((highlight) => highlight.slice(0, 1200))
        }))
      return { status: sources.length ? 'retrieved' : 'unavailable', sources }
    } catch {
      signal.throwIfAborted()
      return { status: 'unavailable', sources: [] }
    }
  }
  return {
    enabled: Boolean(provider.exaKey),
    searchQuery,
    search(category, signal) {
      return searchQuery(queries[category], signal, category === 'wellbeing')
    }
  }
}
