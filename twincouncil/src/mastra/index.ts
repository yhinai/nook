import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Mastra } from '@mastra/core'
import { registerApiRoute } from '@mastra/core/server'
import { z } from 'zod'
import { AskInput } from '../twin/council.ts'
import { errorMessage, log, onLog, recent } from '../twin/log.ts'
import { MemoryFact, recall, remember } from '../twin/memory.ts'
import { NegotiateInput } from '../twin/negotiate.ts'
import { profile, StayInput } from '../twin/profile.ts'
import { peopleAgent, rankerAgent, scoutAgent, verifierAgent } from './agents.ts'
import { careerAgent, checkerAgent, financeAgent, lifestyleAgent, mediatorAgent, researcherAgent, twinAgent } from './council-agents.ts'
import { askTwin, current, negotiateTwins, runPlan } from './run.ts'
import { ask } from './workflows/ask.ts'
import { eventScout, outputDir } from './workflows/event-scout.ts'
import { negotiate } from './workflows/negotiate.ts'

let lastActivity = Date.now()
let inFlight = 0

/** Bearer-token gate. Fails closed in production if no token is configured. */
const requireToken = async (c: { req: { header: (name: string) => string | undefined } }, next: () => Promise<void>) => {
  const expected = process.env.TWIN_API_TOKEN
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return new Response('TWIN_API_TOKEN is not set', { status: 503 })
    return next()
  }
  const given = Buffer.from(c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '')
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return new Response('Unauthorized', { status: 401 })
  }
  lastActivity = Date.now()
  return next()
}

/** Progress lines, then the result, as NDJSON. Bytes keep flowing, so no proxy times the request out. */
function streamed(work: () => Promise<unknown>): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // the client went away; the work still finishes
        }
      }
      const stop = onLog(line => send({ log: line }))
      inFlight++
      try {
        send({ result: await work() })
      } catch (err) {
        send({ error: errorMessage(err) })
      } finally {
        inFlight--
        stop()
        try {
          controller.close()
        } catch {
          // already closed by the client
        }
      }
    },
  })
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
}

const NewMemory = z.object({ text: z.string().min(1), kind: MemoryFact.shape.kind.optional() })

export const mastra = new Mastra({
  agents: {
    twinAgent,
    researcherAgent,
    checkerAgent,
    careerAgent,
    financeAgent,
    lifestyleAgent,
    mediatorAgent,
    scoutAgent,
    verifierAgent,
    rankerAgent,
    peopleAgent,
  },
  workflows: { ask, negotiate, eventScout },
  server: {
    timeout: 10 * 60_000,
    // Mastra's own API (agents, workflows) sits behind the same token as the twin's routes.
    middleware: [{ path: '/api/*', handler: requireToken }],
    apiRoutes: [
      // Ask the twin. Body: { question, person?, others? }
      registerApiRoute('/twin/ask', {
        method: 'POST',
        middleware: [requireToken],
        handler: async c => {
          const input = AskInput.safeParse(await c.req.json().catch(() => ({})))
          if (!input.success) return c.json({ error: 'invalid request', issues: input.error.issues }, 400)
          return streamed(() => askTwin(input.data))
        },
      }),
      // Twin-to-twin. Body: { a, b, request }
      registerApiRoute('/twin/negotiate', {
        method: 'POST',
        middleware: [requireToken],
        handler: async c => {
          const input = NegotiateInput.safeParse(await c.req.json().catch(() => ({})))
          if (!input.success) return c.json({ error: 'invalid request', issues: input.error.issues }, 400)
          return streamed(() => negotiateTwins(input.data))
        },
      }),
      registerApiRoute('/twin/memory/:person', {
        method: 'GET',
        middleware: [requireToken],
        handler: async c => {
          try {
            return c.json(await recall(c.req.param('person') ?? ''))
          } catch (err) {
            return c.json({ error: errorMessage(err) }, 400)
          }
        },
      }),
      // Teach the twin something. Body: { text, kind? }
      registerApiRoute('/twin/memory/:person', {
        method: 'POST',
        middleware: [requireToken],
        handler: async c => {
          const input = NewMemory.safeParse(await c.req.json().catch(() => ({})))
          if (!input.success) return c.json({ error: 'invalid request', issues: input.error.issues }, 400)
          try {
            return c.json(await remember(c.req.param('person') ?? '', input.data.text, input.data.kind))
          } catch (err) {
            return c.json({ error: errorMessage(err) }, 400)
          }
        },
      }),
      // Start an event scout. Body: { city, mode?, start?, end? } for one stay, or {} for the whole itinerary.
      registerApiRoute('/twin/scout', {
        method: 'POST',
        middleware: [requireToken],
        handler: async c => {
          if (current.state === 'running') {
            return c.json({ error: 'a scout is already running', startedAt: current.startedAt }, 409)
          }
          const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
          let plan = profile.itinerary
          if (body.city !== undefined) {
            const stay = StayInput.safeParse(body)
            if (!stay.success) return c.json({ error: 'invalid stay', issues: stay.error.issues }, 400)
            plan = [stay.data]
          }
          // Runs in the background; the machine stays up until it finishes (see the idle timer below).
          void runPlan(plan)
          return c.json({ started: true, plan, status: '/twin/status', result: '/twin/events.md' }, 202)
        },
      }),
      registerApiRoute('/twin/status', {
        method: 'GET',
        middleware: [requireToken],
        handler: async c => c.json({ ...current, log: recent.slice(-40) }),
      }),
      registerApiRoute('/twin/events.md', {
        method: 'GET',
        middleware: [requireToken],
        handler: async c => {
          const markdown = await readFile(join(outputDir(), 'events.md'), 'utf8').catch(() => null)
          if (markdown === null) return c.json({ error: 'no events.md yet; POST /twin/scout first' }, 404)
          return new Response(markdown, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
        },
      }),
    ],
  },
})

// Scale to zero on Fly: exit once idle, so the Machine stops and the proxy starts it again on the
// next request. Fly's own auto-stop is off because it would stop the Machine in the middle of a run.
const idleMinutes = Number(process.env.TWIN_IDLE_EXIT_MIN ?? 0)
if (idleMinutes > 0) {
  setInterval(() => {
    if (current.state === 'running' || inFlight > 0) lastActivity = Date.now()
    else if (Date.now() - lastActivity > idleMinutes * 60_000) {
      log(`idle for ${idleMinutes} minutes, exiting`)
      process.exit(0)
    }
  }, 30_000).unref()
}
