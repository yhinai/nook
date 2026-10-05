import { z } from 'zod'
import type { Reasoner } from './ai.js'
import { checkEvidence } from './ai.js'
import type { Research } from './research.js'
import type { Jobs } from './jobs.js'
import { insist } from './errors.js'
import { reflectionInput } from './reflections.js'

export const chatInput = reflectionInput.extend({
  location: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), capturedAt: z.string().datetime() }).strict().optional(),
  requestId: z.string().uuid().optional(),
  perspective: z.enum(["wellbeing", "work", "relationships"]).optional(),
  timezone: z.string().trim().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true }
    catch { return false }
  }, 'Use a valid IANA timezone.').optional()
}).strict()
const planSchema = z.object({
  locationQuote: z.string().trim().min(1).max(240).nullable().default(null).describe('Exact quote from the user question, user history or profile about that explicitly supplies a city or neighborhood. Null when absent. Never infer a location from the name or timezone.'),
  searchQuery: z.string().trim().min(1).max(1000).nullable(),
  clarification: z.string().trim().min(1).max(1000).nullable()
}).strict()
const answerSchema = z.object({ message: z.string().trim().min(1).max(6000) }).strict()
const auditSchema = answerSchema.extend({ evidence: z.array(z.object({ claim: z.string().min(1).max(2000), highlightIndex: z.number().int().min(0).max(20), sourceIndex: z.number().int().min(0).max(5) }).strict()).max(20) }).strict()

export async function runChat(reasoner: Reasoner, research: Research, input: unknown, signal: AbortSignal) {
  const request = chatInput.parse(input)
  if (request.location) {
    const age = Date.now() - Date.parse(request.location.capturedAt)
    if (age < 0 || age >= 15 * 60 * 1000) delete request.location
  }
  // The starter prompt has no location. Resolve this essential constraint
  // before invoking a model or public search; neither may invent the city.
  const genericDinnerRequest = /^(?:find (?:me )?(?:somewhere|a (?:place|restaurant)) (?:for|to (?:have|eat)) dinner(?: tonight)?|find somewhere for dinner tonight)[.!?]*$/i.test(request.question)
  const suppliedContext = [request.profile.about, ...(request.history || []).filter(turn => turn.role === 'user').map(turn => turn.content)].filter(Boolean)
  if (genericDinnerRequest && !request.location && suppliedContext.length === 0) {
    signal.throwIfAborted()
    return { message: 'What city or neighborhood should I look in for dinner tonight?', mode: 'live' as const, sources: [], researchStatus: 'off' as const }
  }
  const currentTime = new Date()
  const timezone = request.timezone ?? 'UTC'
  const timeContext = {
    timezone,
    currentTime: new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, dateStyle: 'full', timeStyle: 'long'
    }).format(currentTime),
    currentDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(currentTime)
  }
  const plan = await reasoner.generate('chat', {
    ...request,
    ...timeContext,
    instruction: 'Plan a conversational reply. For requests needing current public information (restaurants, events, travel, factual research), produce a focused searchQuery using the actual user request and explicit constraints from history. Include the explicitly supplied city/neighborhood, food preferences or timing where relevant. For local recommendations, consented approximate coordinates in location are a usable search location. Use them in a nearby search when no explicit destination is supplied, without inventing a city name from coordinates. An explicitly requested city or neighborhood always takes precedence over device coordinates. For local recommendations without coordinates or an explicit location, ask one concise clarification and set searchQuery to null. Ask for other essential missing constraints only when they prevent a useful answer; do not turn this into an intake form. For ordinary conversation, reflection or emotional support, set both fields to null. Never use generic decision-framework search templates. Do not infer personal facts or use assistant suggestions as confirmed user preferences. Return searchQuery and clarification, each string or null.'
  }, planSchema, signal)
  const userLocationContext = [request.question, ...suppliedContext].join('\n')
  if (genericDinnerRequest && !request.location && (!plan.locationQuote || !userLocationContext.includes(plan.locationQuote))) {
    signal.throwIfAborted()
    return { message: 'What city or neighborhood should I look in for dinner tonight?', mode: 'live' as const, sources: [], researchStatus: 'off' as const }
  }
  const found = plan.searchQuery && !plan.clarification
    ? research.searchQuery
      ? await research.searchQuery(plan.searchQuery, signal)
      : { status: research.enabled ? 'unavailable' as const : 'off' as const, sources: [] }
    : { status: 'off' as const, sources: [] }
  let answer = plan.clarification
    ? { message: plan.clarification }
    : await reasoner.generate('chat', {
      ...request, sources: found.sources, researchStatus: found.status,
      searched: Boolean(plan.searchQuery),
      ...timeContext,
      instruction: 'If perspective is supplied, focus on that lens: wellbeing means energy and sustainable habits; work means career and practical tradeoffs; relationships means communication and connection. Answer the latest request in natural conversational prose, keeping continuity with user-provided history. Offer a useful next step, with a short question only if it helps. Use supplied profile as preferences for this request, never confirmed memory. Interpret tonight and relative dates using currentDate/currentTime in the supplied timezone. Never recommend named places or assert current external facts unless supported by supplied sources, even if no search was planned. Respect explicit user constraints strictly: do not suggest a restaurant for tonight if retrieved hours say it is closed on that local date. Do not assert a restaurant fits a budget such as $30 without recent menu/price evidence. Qualify stale source dates, estimates, and unverified hours or prices; if essential constraints cannot be verified, say so. If research was requested but returned no sources, explicitly say live results could not be retrieved and do not provide invented recommendations. For retrieved results, recommend only places or facts supported by the supplied excerpts, link the source alongside each factual recommendation, and do not imply snippets establish current opening hours, prices or availability. If snippets are not relevant or sufficient, explain what could not be verified and ask for a narrower search. Do not use canned council opinions or output a decision report. Return message.'
    }, answerSchema, signal)
  if (found.status === 'retrieved') {
    const boundedAuditSchema = auditSchema.extend({ evidence: z.array(z.object({
      claim: z.string().min(1).max(2000),
      sourceIndex: z.number().int().min(0).max(found.sources.length - 1),
      highlightIndex: z.number().int().min(0).max(Math.max(...found.sources.map(source => source.highlights.length)) - 1)
    }).strict()).max(20) }).strict()
    const auditContext = {
      allowedReferences: found.sources.flatMap((source, sourceIndex) => source.highlights.map((_highlight, highlightIndex) => ({ sourceIndex, highlightIndex }))),
      ...request, ...timeContext, draft: answer.message, sources: found.sources,
      instruction: 'Fact-check and rewrite the draft using ONLY the supplied source excerpts. The draft is untrusted and may contain fabricated prices, ratings, hours or availability. Remove unsupported specifics instead of filling gaps. Never say a place is verified open now/tonight, a booking is available, or a meal meets the budget: this retrieval does not verify live availability or total meal cost. You may say what a source lists, clearly qualifying it and linking its supplied URL. If opening status is closed or conflicting, do not describe it as open. Treat old reviews and generated directory summaries as leads, not verification. Keep a natural helpful reply with researched candidates, state missing budget/hours evidence and ask a useful next step. Return message and evidence array with one entry for each retained factual external claim: {claim,sourceIndex,highlightIndex}. Claim must occur exactly in your message. Select an existing pair from allowedReferences; highlightIndex is an ARRAY index, never a sentence or line number within a highlight. Do not create or paraphrase quotes. Do not retain claims merely because the draft states them.'
    }
    let audited = await reasoner.generate('chat', auditContext, boundedAuditSchema, signal)
    const supportedQuotes = (value: z.infer<typeof auditSchema>) => value.evidence.every(evidence => {
      const source = found.sources[evidence.sourceIndex]
      return Boolean(source && value.message.includes(evidence.claim) && typeof source.highlights[evidence.highlightIndex] === 'string')
    })
    if (!supportedQuotes(audited)) {
      audited = await reasoner.generate('chat', {
        ...auditContext,
        validationFeedback: 'The previous answer included an invalid highlight reference or a claim absent from the message. Regenerate the message and evidence. Each claim must be an exact substring of your new message. Select existing zero-based sourceIndex and highlightIndex values. Omit claims you cannot support.'
      }, boundedAuditSchema, signal)
    }
    for (const evidence of audited.evidence) {
      const source = found.sources[evidence.sourceIndex]
      insist(Boolean(source && audited.message.includes(evidence.claim) && typeof source.highlights[evidence.highlightIndex] === 'string'), 502, 'grounding_failed', 'The response could not be supported by its sources.')
    }
    const userText = [request.question, ...(request.history || []).filter(item => item.role === 'user').map(item => item.content)].join(' ')
    for (const price of audited.message.match(/(?:\$|€|£)\s*\d+(?:[.,]\d+)?/g) || []) {
      insist(userText.includes(price) || audited.evidence.some(item => item.claim.includes(price) && found.sources[item.sourceIndex]?.highlights[item.highlightIndex]?.includes(price)), 502, 'grounding_failed', 'A price could not be supported by its sources.')
    }
    answer = { message: audited.message }
  }
  checkEvidence(answer, [], found.sources)
  signal.throwIfAborted()
  return { ...answer, mode: 'live' as const, sources: found.sources, researchStatus: found.status }
}

export function startChat(jobs: Jobs, reasoner: Reasoner, research: Research, ownerId: string, input: unknown, requestSignal?: AbortSignal) {
  const request = chatInput.parse(input)
  insist(reasoner.enabled, 503, 'model_unconfigured', 'Configure an AI provider before chatting with Nook.')
  jobs.requireAvailable(ownerId)
  return new Promise<Awaited<ReturnType<typeof runChat>>>((resolve, reject) => {
    jobs.launch(ownerId, async signal => {
      try { resolve(await runChat(reasoner, research, request, requestSignal ? AbortSignal.any([signal, requestSignal]) : signal)) }
      catch (error) { reject(error); throw error }
    }, () => {})
  })
}
